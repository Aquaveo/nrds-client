
from typing import Optional, Dict, Any
from typing_extensions import Annotated
from pydantic import Field
from fastmcp import FastMCP

from .utils import _get_json_raw, _prefer_id_objects, _as_id, REST_API_HOST, _parse_iso_date, DEFAULT_TZ, DEFAULT_START, DATE_PATTERN, _date_from_item
from .validations import FORECASTS, VPUS, MODELS, MEDIUM_RANGE_CYCLES, SHORT_RANGE_CYCLES, ANALYSIS_ASSIM_EXTEND_CYCLES
from datetime import datetime

mcp = FastMCP("NRDS MCP Server")

@mcp.tool(name="healthcheck", description="Check connectivity to the NRDS REST API host.")
def healthcheck() -> Dict[str, Any]:
    raw = _get_json_raw("list_available_models")
    raw = _prefer_id_objects(raw, "models")

    models = raw.get("models") or []
    sample_models = [m.get("id") for m in models[:5] if isinstance(m, dict)]

    return {
        "ok": True,
        "host": REST_API_HOST,
        "model_count": len(models),
        "sample_models": sample_models,
    }

@mcp.tool(name="list_available_models", description="List available NRDS models")
def list_available_models_tool() -> Dict[str, Any]:
    raw = _get_json_raw("list_available_models")
    raw = _prefer_id_objects(raw, "models")
    return raw

@mcp.tool(
    name="list_available_dates",
    description=(
        "List available dates for a given model (returns id + label). "
        "Supports date-range filtering with start/end (ISO YYYY-MM-DD or YYYY/MM/DD). "
        "Defaults: start=2025-08-01, end=today (America/Denver). "
        "Pagination is applied after filtering using offset/limit."
    ),
)
def list_available_dates_tool(
    model: Annotated[MODELS, Field(description="Model id")],
    offset: Annotated[int, Field(ge=0, description="Number of items to skip for pagination (default 0)")] = 0,
    limit: Annotated[int, Field(ge=0, description="Maximum number of items to return (default 0 for all)")] = 0,
    start: Annotated[
        str,
        Field(
            default=DEFAULT_START,
            pattern=DATE_PATTERN,
            description="Start date (inclusive). ISO YYYY-MM-DD or YYYY/MM/DD. Default 2025-08-01.",
        ),
    ] = DEFAULT_START,
    end: Annotated[
        Optional[str],
        Field(
            default=None,
            pattern=DATE_PATTERN,
            description="End date (inclusive). ISO YYYY-MM-DD or YYYY/MM/DD. Default is today's date (America/Denver).",
        ),
    ] = None,
) -> Dict[str, Any]:
    # Resolve defaults and validate range
    start_date = _parse_iso_date(start)
    end_date = _parse_iso_date(end) if end is not None else datetime.now(DEFAULT_TZ).date()

    if start_date > end_date:
        raise ValueError(f"'start' must be <= 'end' (got start={start_date}, end={end_date})")

    raw = _get_json_raw("list_available_dates", params={"model": model})
    raw = _prefer_id_objects(raw, "dates")

    dates = raw.get("dates") or []
    if isinstance(dates, list) and dates and isinstance(dates[0], dict):
        # Filter by date range (inclusive)
        filtered: list[dict] = []
        for item in dates:
            di = _date_from_item(item)
            if di is None:
                continue
            if start_date <= di <= end_date:
                filtered.append(item)

        # Apply pagination after filtering
        if offset or (limit and limit > 0):
            raw["dates"] = filtered[offset : (offset + limit) if limit else None]
        else:
            raw["dates"] = filtered

    return raw


@mcp.tool(
        name="list_available_forecasts", 
        description="List available forecasts for a given model and date"
        )
def list_available_forecast_tool(
    model: Annotated[MODELS, Field(description="Model id")],
    date: Annotated[
        str,
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ],
) -> Dict[str, Any]:
    raw = _get_json_raw("list_available_forecast", params={"model": model, "date": date})
    raw = _prefer_id_objects(raw, "forecasts")
    return raw

@mcp.tool(
        name="list_available_cycles", 
        description="List available cycles for a given model, date, and forecast"
        )
def list_available_cycles_tool(
    model: Annotated[MODELS, Field(description="Model id")],
    date: Annotated[
        str,
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ],
    forecast: Annotated[FORECASTS, Field(description="Forecast id", pattern=r"^(short_range|medium_range|analysis_assim_extend)$")],
) -> Dict[str, Any]:
    forecast_id = _as_id(forecast)
    raw = _get_json_raw(
        "list_available_cycles",
        params={"model": model, "date": date, "forecast": forecast_id},
    )
    # cycles are already stable, but normalize to {id,label} anyway
    raw = _prefer_id_objects(raw, "cycles")
    return raw


@mcp.tool(name="list_available_vpus", 
          description="List available VPUs for a given model, date, forecast, and cycle"
          )
def list_available_vpus_tool(
    model: Annotated[MODELS, Field(description="Model id")],
    date: Annotated[
        str,
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ],
    forecast: Annotated[FORECASTS, Field(description="Forecast id", pattern=r"^(short_range|medium_range|analysis_assim_extend)$")],
    cycle: Annotated[str, Field(description="Hourly cycle (00-23). short_range forecast (hourly, every hour), \
                                medium_range forecast (4 times per day, every 6 hours, first member), \
                                analysis_assim_extend forecast (once per day at 16z)",
                                pattern=r"^(?:[01]\d|2[0-3])$")],
    ) -> Dict[str, Any]:
    forecast_id = _as_id(forecast)
    raw = _get_json_raw(
        "list_available_vpus",
        params={"model": model, "date": date, "forecast": forecast_id, "cycle": cycle},
    )
    raw = _prefer_id_objects(raw, "vpus")
    return raw


@mcp.tool(
        name="list_available_outputs_files", 
        description="List available output files for a given model, date, forecast, cycle, and VPU (accepts id or label). Optional ensemble member for applicable forecast."
        )
def list_available_outputs_files_tool(
    model: Annotated[MODELS, Field(description="Model id")],
    date: Annotated[
        str,
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ],
    forecast: Annotated[FORECASTS, Field(description="Forecast id", pattern=r"^(short_range|medium_range|analysis_assim_extend)$")],
    cycle: Annotated[str, Field(description="Hourly cycle (00-23). short_range forecast (hourly, every hour), \
                                medium_range forecast (4 times per day, every 6 hours, first member), \
                                analysis_assim_extend forecast (once per day at 16z)",
                                pattern=r"^(?:[01]\d|2[0-3])$")],
    vpu: Annotated[VPUS, Field(description="VPU id")],
    ensemble: Annotated[Optional[str], Field(description="Optional ensemble member (1 or 16)", pattern=r"^(?:1|16)$")] = None,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "model": model,
        "date": date,
        "forecast": _as_id(forecast),
        "cycle": cycle,
        "vpu": _as_id(vpu),
    }
    if ensemble is not None:
        params["ensemble"] = int(ensemble)

    raw = _get_json_raw("list_available_outputs_files", params=params)
    return raw

@mcp.tool(
    name="list_available_outputs_files_short_range",
    description="List available output files for short_range (hourly) forecast. cycle must be 00-23.",
)
def list_available_outputs_files_short_range_tool(
    model: Annotated[MODELS, Field(description="Model id")],
    date: Annotated[
        str,
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ],
    cycle: Annotated[SHORT_RANGE_CYCLES, Field(description="Hourly cycle for short_range (00-23)")],
    vpu: Annotated[VPUS, Field(description="VPU id")],
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "model": model,
        "date": date,
        "forecast": "short_range",
        "cycle": cycle,
        "vpu": _as_id(vpu),
    }
    return _get_json_raw("list_available_outputs_files", params=params)


@mcp.tool(
    name="list_available_outputs_files_medium_range",
    description="List available output files for medium_range (6-hourly) forecast. cycle must be 00/06/12/18. Uses ensemble=1 (first member).",
)
def list_available_outputs_files_medium_range_tool(
    model: Annotated[MODELS, Field(description="Model id")],
    date: Annotated[
        str,
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ],
    cycle: Annotated[MEDIUM_RANGE_CYCLES, Field(description="6-hourly cycle for medium_range (00/06/12/18)")],
    vpu: Annotated[VPUS, Field(description="VPU id")],
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "model": model,
        "date": date,
        "forecast": "medium_range",
        "cycle": cycle,
        "vpu": _as_id(vpu),
    }
    return _get_json_raw("list_available_outputs_files", params=params)


@mcp.tool(
    name="list_available_outputs_files_analysis_assim_extend",
    description="List available output files for analysis_assim_extend forecast. cycle is always 16.",
)
def list_available_outputs_files_analysis_assim_extend_tool(
    model: Annotated[MODELS, Field(description="Model id")],
    date: Annotated[
        str,
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ],
    cycle: Annotated[ANALYSIS_ASSIM_EXTEND_CYCLES, Field(description="Only valid cycle for analysis_assim_extend is 16")],
    vpu: Annotated[VPUS, Field(description="VPU id")],
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "model": model,
        "date": date,
        "forecast": "analysis_assim_extend",
        "cycle": cycle,
        "vpu": _as_id(vpu),
    }
    return _get_json_raw("list_available_outputs_files", params=params)

@mcp.tool(
    name="read_parquet_output_file",
    description="Read a parquet output file from S3 given its s3_url. Returns columns and data (as list of lists)."
)
def read_parquet_output_file_tool(
    s3_url: Annotated[str, Field(description="Full S3 URL to the parquet file (e.g. s3://bucket/path/to/file.parquet)", pattern=r"^s3://.+\.parquet$")],
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "s3_url": s3_url,
    }
    return _get_json_raw("read_parquet_output_file", params=params)

@mcp.tool(
    name="query_parquet_output_file",
    description="Run a SQL query against a parquet output file in S3 using DuckDB. Provide the S3 URL to the parquet file and the SQL query (e.g. SELECT * FROM s3_parquet('s3://bucket/path/to/file.parquet') LIMIT 10). Returns query results as list of dicts."
)
def query_parquet_output_file_tool(
    s3_url: Annotated[str, Field(description="Full S3 URL to the parquet file (e.g. https://bucket/path/to/file.parquet)", pattern=r"^https://.+\.parquet$")],
    query: Annotated[
        str,
        Field(
            description="DuckDB SQL query (read-only). Must start with SELECT or WITH.",
            pattern=r"(?is)^\s*(?:WITH\b.*?\bSELECT\b|SELECT\b).*$",
        ),
    ]
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "s3_url": s3_url,
        "query": query,
     }
    return _get_json_raw("query_parquet_output_file", params=params)

@mcp.tool(
    name="query parquet output file timeseries",
    description="Run a SQL query against multiple parquet output files in S3 using DuckDB. Provide a list of S3 URLs to the parquet files and the SQL query (e.g. SELECT * FROM s3_parquet('s3://bucket/path/to/files_*.parquet') WHERE date >= '2025-08-01'). Returns query results as list of dicts."
)
def query_parquet_output_file_timeseries_tool(
    s3_urls: Annotated[str, Field(description="Comma-separated list of S3 URLs to the parquet files (e.g. s3://bucket/path/to/files_*.parquet)", pattern=r"^https://.+\.parquet(,s3://.+\.parquet)*$")],
    feature_id: Annotated[Optional[str], Field(description="Optional feature id to filter the query results (e.g. a specific basin or location id)", pattern=r"^\w+$")] = None,
    type: Annotated[Optional[str], Field(description="Optional type to filter the query results (e.g. 'basin' or 'location')", pattern=r"^\w+$")] = None,
    start: Annotated[Optional[str], Field(description="Optional start date to filter the query results (inclusive). ISO YYYY-MM-DD or YYYY/MM/DD.", pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$")] = None,
    end: Annotated[Optional[str], Field(description="Optional end date to filter the query results (inclusive). ISO YYYY-MM-DD or YYYY/MM/DD.", pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$")] = None,
    variables: Annotated[Optional[str], Field(description="Optional comma-separated list of variables/columns to include in the query results (e.g. 'streamflow,precipitation')", pattern=r"^\w+(,\w+)*$")] = None,
    limit: Annotated[Optional[int], Field(description="Optional limit on the number of rows to return", ge=1)] = None,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "s3_urls": s3_urls,
        feature_id and "feature_id": feature_id,
        type and "type": type,
        start and "start": start,
        end and "end": end,
        variables and "variables": variables,
        limit and "limit": limit,
        
     }
    return _get_json_raw("query_parquet_output_file_timeseries", params=params)

@mcp.tool(
    name="query_netcdf_output_file",
    description="Run a SQL query against a netcdf output file in S3 using DuckDB. Provide the S3 URL to the netcdf file and the SQL query (e.g. SELECT * FROM read_netcdf_output_file('s3://bucket/path/to/file.nc') LIMIT 10). Returns query results as list of dicts."
)
def query_netcdf_output_file_tool(
    s3_url: Annotated[str, Field(description="Full S3 URL to the netcdf file (e.g. https://bucket/path/to/file.nc)", pattern=r"^https://.+\.nc$")],
    query: Annotated[
        str,
        Field(
            description="DuckDB SQL query (read-only). Must start with SELECT or WITH.",
            pattern=r"(?is)^\s*(?:WITH\b.*?\bSELECT\b|SELECT\b).*$",
        ),
    ]
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "s3_url": s3_url,
        "query": query,
     }
    return _get_json_raw("query_netcdf_output_file", params=params)

@mcp.tool(
    name="query_netcdf_output_file_timeseries",
    description="Run a SQL query against multiple netcdf output files in S3 using DuckDB. Provide a list of S3 URLs to the netcdf files and the SQL query (e.g. SELECT * FROM read_netcdf_output_file('s3://bucket/path/to/files_*.nc') WHERE date >= '2025-08-01'). Returns query results as list of dicts."
)
def query_netcdf_output_file_timeseries_tool(
    s3_urls: Annotated[str, Field(description="Comma-separated list of S3 URLs to the netcdf files (e.g. s3://bucket/path/to/files_*.nc)", pattern=r"^https://.+\.nc(,https://.+\.nc)*$")],
    feature_id: Annotated[Optional[str], Field(description="Optional feature id to filter the query results (e.g. a specific basin or location id)", pattern=r"^\w+$")] = None,
    type: Annotated[Optional[str], Field(description="Optional type to filter the query results (e.g. 'basin' or 'location')", pattern=r"^\w+$")] = None,
    start: Annotated[Optional[str], Field(description="Optional start date to filter the query results (inclusive). ISO YYYY-MM-DD or YYYY/MM/DD.", pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$")] = None,
    end: Annotated[Optional[str], Field(description="Optional end date to filter the query results (inclusive). ISO YYYY-MM-DD or YYYY/MM/DD.", pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$")] = None,
    variables: Annotated[Optional[str], Field(description="Optional comma-separated list of variables/columns to include in the query results (e.g. 'streamflow,precipitation')", pattern=r"^\w+(,\w+)*$")] = None,
    limit: Annotated[Optional[int], Field(description="Optional limit on the number of rows to return", ge=1)] = None,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "s3_urls": s3_urls,
        feature_id and "feature_id": feature_id,
        type and "type": type,
        start and "start": start,
        end and "end": end,
        variables and "variables": variables,
        limit and "limit": limit,
     }
    return _get_json_raw("query_netcdf_output_file_timeseries", params=params)


if __name__ == "__main__":
    mcp.run(transport="sse", port=9000)
