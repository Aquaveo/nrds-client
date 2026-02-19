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

@controller(url='api/list-available-outputs-files', login_required=False)
@api_view(['GET'])
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

    return JsonResponse({
        "path": s3_url,
        "files": files
    }, safe=False)

@controller(url='api/list-available-vpus', login_required=False)
@api_view(['GET'])
def list_available_vpus(request):
    """List VPUs for a given model, date, forecast, and cycle."""
    model = request.GET.get("model")
    date = _normalize_date_folder(request.GET.get("date"))
    forecast = request.GET.get("forecast")
    cycle = request.GET.get("cycle")

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += f"/1"

    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)
    vpus = [d.split("/")[-1].replace("_"," ") for d in dirs]

    return JsonResponse({
        "path": s3_url,
        "vpus": vpus
    }, safe=False)

@controller(url='api/list-available-cycles', login_required=False)
@api_view(['GET'])
def list_available_cycles(request):
    """List available cycles for a given model, date, and forecast"""
    model = request.GET.get("model")
    date = _normalize_date_folder(request.GET.get("date"))
    forecast = request.GET.get("forecast")
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)
    cycles = [d.split("/")[-1] for d in dirs]
    return JsonResponse({
        "path": s3_url,
        "cycles": cycles
    }, safe=False)

@controller(url='api/list-available-forecasts', login_required=False)
@api_view(['GET'])
def list_available_forecasts(request):
    """List available forecasts for a given model, date, and cycle"""
    model = request.GET.get("model")
    date = _normalize_date_folder(request.GET.get("date"))
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)
    forecasts = [d.split("/")[-1].replace("_"," ") for d in dirs]
    return JsonResponse({
        "path": s3_url,
        "forecasts": forecasts
    }, safe=False)

@controller(url='api/list-available-dates', login_required=False)
@api_view(['GET'])
def list_avaiable_dates(request):
    """List available dates for a given model"""
    model = request.GET.get("model")
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)
    date_folders = [d.split("/")[-1].rstrip("/") for d in dirs]
    dates_yyyymmdd = [
        _extract_yyyymmdd_from_date_folder(folder) for folder in date_folders
    ]
    dates_yyyymmdd = [d for d in dates_yyyymmdd if d]
    dates_iso = [datetime.strptime(s, "%Y%m%d").date().isoformat() for s in dates_yyyymmdd]
    return JsonResponse({
        "path": s3_url,
        "dates": dates_iso
    }, safe=False)

@controller(url='api/list-available-models', login_required=False)
@api_view(['GET'])
def list_available_models(request):
    """List available models"""
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)
    models = [d.split("/")[-1] for d in dirs]
    return JsonResponse({
        "path": s3_url,
        "models": models
    }, safe=False)

@controller(url='api/read-output-file', login_required=False)
@api_view(['GET'])
def read_output_file(request) -> pd.DataFrame:
    """Read an output file from S3."""
    s3_url = request.GET.get("s3_url")
    df = get_troute_df(s3_url)
    return df

@api_view(['GET'])
def get_status_dir(request):
    """Get the status directory path."""
    return f"s3://{BUCKET}/status/"