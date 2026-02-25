## This are some of the messages that we need to use for the client
DATA_SCHEMA = """(
  time TIMESTAMP_NS,
  feature_id BIGINT,
  type VARCHAR,
  flow FLOAT,
  velocity FLOAT,
  depth FLOAT,
  nudge FLOAT
)"""

SYSTEM_MSG = {
    "role": "system",
    "content": (
        "You may call tools.\n\n"
        "Tool calling rules:\n"
        "1) Only call tools using tool_calls (never plain text).\n"
        "2) Use ONLY argument keys defined in the tool's JSON schema. Do NOT add extra keys.\n"
        "3) Include ALL required arguments from the tool schema.\n"
        "4) Never invent IDs/values for model/forecast/cycle/vpu. If not certain, call the corresponding list_* tool first.\n\n"
        "Query tools (DuckDB):\n"
        "- For Parquet: use query_parquet_output_file (args: s3_url, query). Do NOT use s3_urls/type/args.\n"
        "- For NetCDF: use query_netcdf_output_file (args: s3_url, query). Do NOT use s3_urls/type/args.\n"
        "- SQL queries MUST read FROM output. Never use read_parquet(...) or read_netcdf(...).\n"
        "- Example for feature ids: SELECT DISTINCT feature_id FROM output;\n\n"
        "Data schema for SQL generation:\n"
        f"{DATA_SCHEMA}\n"
    ),
}

DUCKDB_SQL_SYSTEM_MSG = {
    "role": "system",
    "content": (
        "You write DuckDB SQL only. Do NOT call tools.\n"
        "Assume a DuckDB temp view named `output` exists with schema:\n"
        f"{DATA_SCHEMA}\n"
        "Rules:\n"
        "- Always query FROM output (never use read_parquet(...) or read_netcdf(...)).\n"
        "- Return ONLY a single SQL query (no prose, no JSON, no markdown).\n"
        "Example for feature ids: SELECT DISTINCT feature_id FROM output;\n"
    )
}

AUTO_FIX_SYSTEM_MSG = (
    "Fix rules:\n"
    "- Use only schema keys.\n"
    "- For NetCDF: query_netcdf_output_file args=(s3_url, query).\n"
    "- For Parquet: query_parquet_output_file args=(s3_url, query).\n"
    "- Do NOT use s3_urls/type/args.\n"
    "- SQL MUST query FROM output (never read_parquet/read_netcdf).\n"
    "- For distinct feature ids: SELECT DISTINCT feature_id FROM output;\n"
    "Now: return a real tool_call with correct args.\n"
)


FILE_MSG = (
    '{"s3_url": "<url>", "query": "<SQL>"} . \n'
    "Do NOT use s3_urls/type/args. SQL must query FROM output. \n"
    "For distinct feature ids: SELECT DISTINCT feature_id FROM output; \n"
)

DUCK_DB_ROLE_MSG = "Use this DuckDB SQL (read-only). SQL must read FROM output:\n"