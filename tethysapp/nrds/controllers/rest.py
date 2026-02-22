import fsspec
import os
import pandas as pd
from datetime import datetime
from django.http import JsonResponse
from rest_framework.decorators import api_view
from tethys_sdk.routing import controller
from ..data_utils import get_troute_df
from .validators import OutputsFilesQuery
from pydantic import ValidationError
from .utils_rest import (
    _extract_yyyymmdd_from_date_folder,
    _label_from_id,
    _normalize_date_folder,
)

BUCKET = os.getenv("BUCKET","ciroh-community-ngen-datastream")
OUTPUTS_DIR = "outputs"
PREFIX_HYDROFABRIC = "v2.2_hydrofabric"
NGEN_RUN_PREFIX = "ngen-run/outputs/troute"

@controller(url="api/list-available-outputs-files", login_required=False)
@api_view(["GET"])
def list_available_outputs_files(request) -> JsonResponse:
    """List Outputs for a given model, date, forecast, cycle, and vpu."""
    # Convert QueryDict -> plain dict (single values)
    data = {k: request.GET.get(k) for k in request.GET.keys()}

    try:
        q = OutputsFilesQuery.model_validate(data)
    except ValidationError as e:
        # structured pydantic errors (great for agent auto-repair)
        return JsonResponse({"errors": e.errors()}, status=400)
    except ValueError as e:
        # model_validator can raise plain ValueError
        return JsonResponse({"errors": [{"msg": str(e)}]}, status=400)

    model = q.model
    date_folder = _normalize_date_folder(q.date)  # uses normalized YYYY-MM-DD
    forecast = q.forecast
    cycle = q.cycle
    vpu = q.vpu

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date_folder}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += f"/{q.ensemble}/{vpu}/{NGEN_RUN_PREFIX}"
    else:
        s3_url += f"/{vpu}/{NGEN_RUN_PREFIX}"

    try:
        print(f"🔍 Listing files at {s3_url} ...")
        fs = fsspec.filesystem("s3", anon=True)
        outputs = fs.ls(s3_url, detail=False)
        files = [f.split("/")[-1] for f in outputs]
        return JsonResponse({"path": s3_url, "files": files}, safe=False)

    except FileNotFoundError:
        # valid request, just no outputs at that path
        return JsonResponse({"path": s3_url, "files": []}, safe=False)

@controller(url="api/list-available-vpus", login_required=False)
@api_view(["GET"])
def list_available_vpus(request) -> JsonResponse:
    """List VPUs for a given model, date, forecast, and cycle."""
    model = request.GET.get("model")
    date = _normalize_date_folder(request.GET.get("date"))
    forecast = request.GET.get("forecast")
    cycle = request.GET.get("cycle")

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += "/1"
    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)
        vpu_ids = [d.split("/")[-1] for d in dirs]
        vpu_labels = [_label_from_id(v) for v in vpu_ids]
        vpus = [{"id": vid, "label": lbl} for vid, lbl in zip(vpu_ids, vpu_labels)]

        return JsonResponse(
            {
                "path": s3_url,
                "vpus": vpus,
            },
            safe=False,
        )
    except FileNotFoundError:
        return JsonResponse(
            {
                "path": s3_url,
                "vpus": [],
            },
            safe=False,
        )

@controller(url="api/list-available-cycles", login_required=False)
@api_view(["GET"])
def list_available_cycles(request) -> JsonResponse:
    """List available cycles for a given model, date, and forecast"""
    model = request.GET.get("model")
    date = _normalize_date_folder(request.GET.get("date"))
    forecast = request.GET.get("forecast")
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/"

    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        cycle_ids = [d.split("/")[-1] for d in dirs]
        cycles = [{"id": c, "label": c} for c in cycle_ids]

        return JsonResponse(
            {
                "path": s3_url,
                "cycles": cycles,
            },
            safe=False,
        )
    except FileNotFoundError:
        return JsonResponse(
            {
                "path": s3_url,
                "cycles": [],
            },
            safe=False,
        )


@controller(url="api/list-available-forecasts", login_required=False)
@api_view(["GET"])
def list_available_forecasts(request) -> JsonResponse:
    """List available forecasts for a given model, date"""
    model = request.GET.get("model")
    date = _normalize_date_folder(request.GET.get("date"))
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/"
    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        forecast_ids = [d.split("/")[-1] for d in dirs]
        forecast_labels = [_label_from_id(f) for f in forecast_ids]

        forecasts = [{"id": fid, "label": lbl} for fid, lbl in zip(forecast_ids, forecast_labels)]

        return JsonResponse(
            {
                "path": s3_url,
                "forecasts": forecasts,
            },
            safe=False,
        )
    except FileNotFoundError:
        return JsonResponse(
            {
                "path": s3_url,
                "forecasts": [],
            },
            safe=False,
        )

@controller(url="api/list-available-dates", login_required=False)
@api_view(["GET"])
def list_avaiable_dates(request) -> JsonResponse:
    """List available dates for a given model"""
    model = request.GET.get("model")
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}"
    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        date_ids = [d.split("/")[-1].rstrip("/") for d in dirs]  # e.g. ngen.20260218
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
                "dates": dates,
            },
            safe=False,
        )
    except FileNotFoundError:
        return JsonResponse(
            {
                "path": s3_url,
                "dates": [],
            },
            safe=False,
        )

@controller(url="api/list-available-models", login_required=False)
@api_view(["GET"])
def list_available_models(_):
    """List available models"""
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}"
    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        model_ids = [d.split("/")[-1] for d in dirs]
        models = [{"id": mid, "label": mid} for mid in model_ids]

        return JsonResponse(
            {
                "path": s3_url,
                "models": models,
            },
            safe=False,
        )
    except FileNotFoundError:
        return JsonResponse(
            {
                "path": s3_url,
                "models": [],
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
