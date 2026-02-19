import fsspec
import pandas as pd
from rest_framework.decorators import api_view
from .data_utils import get_troute_df

BUCKET = "ciroh-community-ngen-datastream"
OUTPUTS_DIR = "outputs"
PREFIX_HYDROFABRIC = "v2.2_hydrofabric"
NGEN_RUN_PREFIX = "ngen-run/outputs/troute"


@api_view(['GET'])
def list_outputs(model: str, date: str, forecast: str, cycle: str, vpu: str):
    """List Outputs for a given model, date, forecast, cycle, and vpu."""

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += f"/1/{vpu}/{NGEN_RUN_PREFIX}"
    else:
        s3_url += f"/{vpu}/{NGEN_RUN_PREFIX}"

    fs = fsspec.filesystem("s3", anon=True)
    outputs = fs.ls(s3_url, detail=False)
    return outputs

@api_view(['GET'])
def list_available_vpus(model: str, date: str, forecast: str, cycle: str):
    """List VPUs for a given model, date, forecast, and cycle."""

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += f"/1"

    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)
    vpus = [d.split("/")[-1] for d in dirs]
    return vpus

@api_view(['GET'])
def list_available_cycles(model: str, date: str, forecast: str):
    """List available cycles for a given model, date, and forecast"""

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/*"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)
    cycles = [d.split("/")[-2] for d in dirs]
    return cycles

@api_view(['GET'])
def list_available_forecasts(model: str, date: str):
    """List available forecasts for a given model, date, and cycle"""

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)
    forecasts = [d.split("/")[-3] for d in dirs]
    return forecasts

@api_view(['GET'])
def list_avaiable_dates(model: str):
    """List available dates for a given model"""

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)
    dates = [d.split("/")[-4] for d in dirs]
    return dates

@api_view(['GET'])
def list_available_models():
    """List available models"""
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}"
    fs = fsspec.filesystem("s3", anon=True)
    dirs = fs.ls(s3_url, detail=False)
    models = [d.split("/")[-2] for d in dirs]
    return models


@api_view(['GET'])
def read_output_file(s3_url: str) -> pd.DataFrame:
    """Read an output file from S3."""
    df = get_troute_df(s3_url)
    return df

@api_view(['GET'])
def get_status_dir():
    """Get the status directory path."""
    return f"s3://{BUCKET}/status/"