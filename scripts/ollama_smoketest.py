#!/usr/bin/env python3
"""
Run a fixed set of prompts through the interactive Ollama client without using Tethys platform.

Usage:
  python scripts/ollama_smoketest.py

Notes:
- Ensure the MCP server is running and reachable via MCP_SERVER_URL (default: http://127.0.0.1:9000/sse)
- Set OLLAMA_MODEL / MCP_TOOL_REPAIR_ATTEMPTS as needed
"""
import asyncio
import builtins

from tethysapp.nrds.client import client_ollama


PROMPTS = [
    "please list the available models",
    "please list the available dates for model cfe_nom",
    "please list the available forecasts for model cfe_nom and date 2026-02-25",
    "please list the available forecasts for model cfe_nom and date 2026-02-24",
    "please list cycles available for short term forecast on cfe nom model and date 2026-02-24",
    "please list the vpus for short range forecast on cfe nom model and date 2026-02-24 on the first cycle",
    "please list the output files for the short range forecast on cfe nom model and date 2026-02-24 on the first cycle and vpu 6.",
    "please list the different feature ids on https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com/outputs/cfe_nom/v2.2_hydrofabric/ngen.20260224/short_range/00/VPU_06/ngen-run/outputs/troute/troute_output_202602240100.parquet",
    "provide the time series values for variable flow for feature id 1019290 on https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com/outputs/cfe_nom/v2.2_hydrofabric/ngen.20260224/short_range/00/VPU_06/ngen-run/outputs/troute/troute_output_202602240100.parquet",
    "provide a summary of the time series values for variable flow for feature id 1019290 on https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com/outputs/cfe_nom/v2.2_hydrofabric/ngen.20260224/short_range/00/VPU_06/ngen-run/outputs/troute/troute_output_202602240100.parquet",
]


def _make_input_func(prompts):
    it = iter(list(prompts) + [":q"])

    def fake_input(prompt=""):
        try:
            if prompt:
                print(prompt, end="")
            value = next(it)
            print(value)
            return value
        except StopIteration:
            print(":q")
            return ":q"

    return fake_input


def main():
    original_input = builtins.input
    builtins.input = _make_input_func(PROMPTS)
    try:
        asyncio.run(client_ollama.main())
    finally:
        builtins.input = original_input


if __name__ == "__main__":
    main()
