import fsspec
import s3fs
import os
import pyarrow.parquet as pq
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
    _duckdb_query_parquet,
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
        files = [f.split("s3://ciroh-community-ngen-datastream")[-1] for f in outputs]
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

@controller(url="api/read-output-netcdf-file", login_required=False)
@api_view(["GET"])
def read_netcdf_output_file(request) -> JsonResponse:
    """Read an output file from S3."""
    s3_url = request.GET.get("s3_url")
    df = get_troute_df(s3_url)
    lit_df = df.values.tolist()
    columns = df.columns.tolist()
    return JsonResponse({"path": s3_url, "columns": columns, "data": lit_df}, safe=False)
    
@controller(url="api/read-output-parquet-file", login_required=False)
@api_view(["GET"])
def read_parquet_output_file(request) -> JsonResponse:
    """Read a parquet output file from S3."""
    s3_url = request.GET.get("s3_url").strip().split("://", 1)
    s3 = s3fs.S3FileSystem(anon=True)
    dataset = pq.ParquetDataset(s3_url, filesystem=s3)
    df = dataset.read().to_pandas()
    lit_df = df.values.tolist()
    columns = df.columns.tolist()
    return JsonResponse({"path": s3_url, "columns": columns, "data": lit_df}, safe=False)

@controller(url="api/query-output-parquet-file", login_required=False)
@api_view(["GET"])
def query_parquet_output_file(request) -> JsonResponse:
    """Run any DuckDB SQL query against a Parquet file on S3 (view name: `output`)."""
    query = request.GET.get("query")
    file_url = request.GET.get("s3_url")

    if not file_url:
        return JsonResponse({"error": "Missing required query param: s3_url"}, status=400)
    if not query:
        return JsonResponse({"error": "Missing required query param: query"}, status=400)

    try:
        df = _duckdb_query_parquet(file_url, query)

        # Make timestamps JSON-friendly
        if "time" in df.columns:
            df["time"] = pd.to_datetime(df["time"], errors="coerce").dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

        return JsonResponse(
            {
                "file": file_url,
                "query": query,
                "columns": list(df.columns),
                "rows": int(len(df)),
                "data": df.to_dict(orient="records"),
            },
            safe=True,
        )
    except FileNotFoundError:
        return JsonResponse({"file": file_url, "query": query, "columns": [], "rows": 0, "data": []}, status=404)
    except Exception as e:
        return JsonResponse({"file": file_url, "query": query, "error": str(e)}, status=500)

@controller(url="api/query-output-parquet-timeseries", login_required=False)
@api_view(["GET"])
def query_parquet_output_timeseries(request) -> JsonResponse:
    """
    Query a time series from a Parquet file.

    Params:
      - s3_url (required)
      - feature_id (required, int)
      - type (optional)
      - start (optional ISO datetime/date)
      - end (optional ISO datetime/date)
      - variables (optional, comma-separated subset of: flow,velocity,depth,nudge; default all)
      - limit (optional, default 5000)
    """
    file_url = request.GET.get("s3_url")
    feature_id = request.GET.get("feature_id")

    if not file_url:
        return JsonResponse({"error": "Missing required query param: s3_url"}, status=400)
    if feature_id is None:
        return JsonResponse({"error": "Missing required query param: feature_id"}, status=400)

    try:
        fid = int(feature_id)
    except Exception:
        return JsonResponse({"error": "feature_id must be an integer"}, status=400)

    ftype = request.GET.get("type")
    start = request.GET.get("start")
    end = request.GET.get("end")
    variables = request.GET.get("variables") or "flow,velocity,depth,nudge"
    limit = int(request.GET.get("limit", "5000"))

    allowed_vars = {"flow", "velocity", "depth", "nudge"}
    var_list = [v.strip() for v in variables.split(",") if v.strip()]
    var_list = [v for v in var_list if v in allowed_vars]
    if not var_list:
        var_list = ["flow"]

    where = [f"feature_id = {fid}"]
    if ftype:
        safe_type = ftype.replace("'", "''")
        where.append(f"type = '{safe_type}'")
    if start:
        safe_start = start.replace("'", "''")
        where.append(f"time >= TIMESTAMP '{safe_start}'")
    if end:
        safe_end = end.replace("'", "''")
        where.append(f"time <= TIMESTAMP '{safe_end}'")

    cols_sql = ", ".join(["time"] + var_list)
    where_sql = " AND ".join(where)

    query = f"""
        SELECT {cols_sql}
        FROM output
        WHERE {where_sql}
        ORDER BY time
        LIMIT {limit}
    """

    try:
        df = _duckdb_query_parquet(file_url, query)

        # Format time column
        if "time" in df.columns:
            df["time"] = pd.to_datetime(df["time"], errors="coerce").dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

        return JsonResponse(
            {
                "file": file_url,
                "feature_id": fid,
                "type": ftype,
                "variables": var_list,
                "start": start,
                "end": end,
                "limit": limit,
                "query": query.strip(),
                "columns": list(df.columns),
                "rows": int(len(df)),
                "data": df.to_dict(orient="records"),
            },
            safe=True,
        )
    except FileNotFoundError:
        return JsonResponse({"file": file_url, "query": query.strip(), "columns": [], "rows": 0, "data": []}, status=404)
    except Exception as e:
        return JsonResponse({"file": file_url, "query": query.strip(), "error": str(e)}, status=500)

@api_view(["GET"])
def get_status_dir(request):
    """Get the status directory path."""
    return f"s3://{BUCKET}/status/"
