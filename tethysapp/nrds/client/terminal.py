import atexit
import os

def setup_readline():
    try:
        import readline  # noqa: F401
    except Exception:
        return

    histfile = os.path.join(os.path.expanduser("~"), ".nrds_mcp_history")
    try:
        readline.read_history_file(histfile)
    except FileNotFoundError:
        pass

    readline.set_history_length(2000)
    atexit.register(readline.write_history_file, histfile)