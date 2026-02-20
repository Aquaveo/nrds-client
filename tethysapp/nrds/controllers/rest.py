import fsspec
import pandas as pd
from django.http import JsonResponse
from rest_framework.decorators import api_view
from tethys_sdk.routing import controller
from ..data_utils import get_troute_df
from datetime import datetime

BUCKET = "ciroh-community-ngen-datastream"
OUTPUTS_DIR = "outputs"
PREFIX_HYDROFABRIC = "v2.2_hydrofabric"
NGEN_RUN_PREFIX = "ngen-run/outputs/troute"


def _normalize_date_yyyymmdd(date_str: str | None) -> str | None:
    """Normalize a date string to YYYYMMDD.

    Accepts:
      - YYYYMMDD
      - YYYY-MM-DD
      - YYYY/MM/DD
    """
    if not date_str:
        return None

    s = str(date_str).strip()
    if len(s) == 8 and s.isdigit():
        return s

    s = s.replace("/", "-")
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%Y%m%d")
    except ValueError:
        return None


def _normalize_date_folder(date_str: str | None, *, default_prefix: str = "ngen") -> str | None:
    """Normalize a date folder name for the S3 layout.

    The datastream commonly uses folders like: ngen.YYYYMMDD

    Accepts:
      - ngen.YYYYMMDD
      - ngen.YYYY-MM-DD
      - ngen.YYYY/MM/DD
      - YYYYMMDD / YYYY-MM-DD / YYYY/MM/DD (prefix added)
    """
    if not date_str:
        return None

    s = str(date_str).strip()
    if "." in s:
        prefix, tail = s.split(".", 1)
        yyyymmdd = _normalize_date_yyyymmdd(tail)
        return f"{prefix}.{yyyymmdd}" if yyyymmdd else None

    yyyymmdd = _normalize_date_yyyymmdd(s)
    return f"{default_prefix}.{yyyymmdd}" if yyyymmdd else None


def _extract_yyyymmdd_from_date_folder(folder: str) -> str | None:
    """Extract YYYYMMDD from a folder like 'ngen.20260127'."""
    if not folder:
        return None
    base = folder.strip().rstrip("/")
    if "." in base:
        _, tail = base.split(".", 1)
        return _normalize_date_yyyymmdd(tail)
    return _normalize_date_yyyymmdd(base)


def _label_from_id(value: str) -> str:
    """Default label: replace underscores with spaces."""
    return value.replace("_", " ")


# -----------------------------------------------------------------------------
# Outputs files (unchanged; expects IDs for forecast + vpu)
# -----------------------------------------------------------------------------
@controller(url="api/list-available-outputs-files", login_required=False)
@api_view(["GET"])
def list_available_outputs_files(request):
    """List Outputs for a given model, date, forecast, cycle, and vpu."""
    model = request.GET.get("model")
    date = _normalize_date_folder(request.GET.get("date"))
    forecast = request.GET.get("forecast")
    cycle = request.GET.get("cycle")
    vpu = request.GET.get("vpu")

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += f"/1/{vpu}/{NGEN_RUN_PREFIX}"
    else:
        s3_url += f"/{vpu}/{NGEN_RUN_PREFIX}"

    fs = fsspec.filesystem("s3", anon=True)
    outputs = fs.ls(s3_url, detail=False)
    files = [f.split("/")[-1] for f in outputs]

    return JsonResponse({"path": s3_url, "files": files}, safe=False)


# -----------------------------------------------------------------------------
# VPUs: return both id + label
# -----------------------------------------------------------------------------
@controller(url="api/list-available-vpus", login_required=False)
@api_view(["GET"])
def list_available_vpus(request):
    """List VPUs for a given model, date, forecast, and cycle."""
    model = request.GET.get("model")
    date = _normalize_date_folder(request.GET.get("date"))
    forecast = request.GET.get("forecast")
    cycle = request.GET.get("cycle")

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += "/1"

    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)

    vpu_ids = [d.split("/")[-1] for d in dirs]  # e.g. VPU_14, VPU_03N
    vpu_labels = [_label_from_id(v) for v in vpu_ids]  # e.g. VPU 14

    vpus = [{"id": vid, "label": lbl} for vid, lbl in zip(vpu_ids, vpu_labels)]

    return JsonResponse(
        {
            "path": s3_url,
            # new
            "vpus": vpus,
            "vpu_ids": vpu_ids,
            "vpu_labels": vpu_labels,
            # backward-compat (old behavior)
            "vpus_legacy": vpu_labels,
        },
        safe=False,
    )


# -----------------------------------------------------------------------------
# Cycles (already stable IDs)
# -----------------------------------------------------------------------------
@controller(url="api/list-available-cycles", login_required=False)
@api_view(["GET"])
def list_available_cycles(request):
    """List available cycles for a given model, date, and forecast"""
    model = request.GET.get("model")
    date = _normalize_date_folder(request.GET.get("date"))
    forecast = request.GET.get("forecast")

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)

    cycle_ids = [d.split("/")[-1] for d in dirs]  # e.g. 00, 06, 12, 18
    cycles = [{"id": c, "label": c} for c in cycle_ids]

    return JsonResponse(
        {
            "path": s3_url,
            # new
            "cycles": cycles,
            "cycle_ids": cycle_ids,
            "cycle_labels": cycle_ids,
            # backward-compat
            "cycles_legacy": cycle_ids,
        },
        safe=False,
    )


# -----------------------------------------------------------------------------
# Forecasts: return both id + label
# -----------------------------------------------------------------------------
@controller(url="api/list-available-forecasts", login_required=False)
@api_view(["GET"])
def list_available_forecasts(request):
    """List available forecasts for a given model, date"""
    model = request.GET.get("model")
    date = _normalize_date_folder(request.GET.get("date"))

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)

    forecast_ids = [d.split("/")[-1] for d in dirs]         # e.g. short_range, medium_range
    forecast_labels = [_label_from_id(f) for f in forecast_ids]  # e.g. short range

    forecasts = [{"id": fid, "label": lbl} for fid, lbl in zip(forecast_ids, forecast_labels)]

    return JsonResponse(
        {
            "path": s3_url,
            # new
            "forecasts": forecasts,
            "forecast_ids": forecast_ids,
            "forecast_labels": forecast_labels,
            # backward-compat (old behavior)
            "forecasts_legacy": forecast_labels,
        },
        safe=False,
    )


# -----------------------------------------------------------------------------
# Dates: return both id (folder name) + label (ISO date)
# -----------------------------------------------------------------------------
@controller(url="api/list-available-dates", login_required=False)
@api_view(["GET"])
def list_avaiable_dates(request):
    """List available dates for a given model"""
    model = request.GET.get("model")

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)

    date_ids = [d.split("/")[-1].rstrip("/") for d in dirs]  # e.g. ngen.20260218

    # Labels as ISO dates, where possible
    labels = []
    for folder in date_ids:
        yyyymmdd = _extract_yyyymmdd_from_date_folder(folder)
        if yyyymmdd:
            labels.append(datetime.strptime(yyyymmdd, "%Y%m%d").date().isoformat())
        else:
            labels.append(folder)

    dates = [{"id": did, "label": lbl} for did, lbl in zip(date_ids, labels)]

    return JsonResponse(
        {
            "path": s3_url,
            # new
            "dates": dates,
            "date_ids": date_ids,
            "date_labels": labels,
            # backward-compat (old behavior)
            "dates_legacy": labels,
        },
        safe=False,
    )


# -----------------------------------------------------------------------------
# Models: return both id + label (same for now)
# -----------------------------------------------------------------------------
@controller(url="api/list-available-models", login_required=False)
@api_view(["GET"])
def list_available_models(request):
    """List available models"""
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)

    model_ids = [d.split("/")[-1] for d in dirs]
    models = [{"id": mid, "label": mid} for mid in model_ids]

    return JsonResponse(
        {
            "path": s3_url,
            "models": models,
            "model_ids": model_ids,
            "model_labels": model_ids,
            # backward-compat
            "models_legacy": model_ids,
        },
        safe=False,
    )


@controller(url="api/read-output-file", login_required=False)
@api_view(["GET"])
def read_output_file(request) -> pd.DataFrame:
    """Read an output file from S3."""
    s3_url = request.GET.get("s3_url")
    df = get_troute_df(s3_url)
    return df


@api_view(["GET"])
def get_status_dir(request):
    """Get the status directory path."""
    return f"s3://{BUCKET}/status/"
