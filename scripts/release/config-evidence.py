"""Bounded, read-only owner evidence; the release qualify command remains the gate."""
import os
import posixpath
import stat
import sys
import tomllib


def inspect_configuration(started, fs=os, emit=print):
    seen = set()
    budget = 1024 * 1024

    def validate(value, kind, timed):
        if (stat.S_IFMT(value.st_mode) != kind or value.st_uid != 0
                or value.st_mode & 0o022 or timed and value.st_ctime + 1 >= started):
            raise ValueError("Unqualified input")

    def visit(path, imported=False):
        nonlocal budget
        if (not isinstance(path, str) or not path.startswith("/") or path == "/"
                or posixpath.normpath(path) != path or path.startswith("//")
                or any(ord(c) <= 32 or ord(c) == 127 or c in "*?[]{}\\" for c in path)
                or path in seen or len(seen) >= 64):
            raise ValueError("Unqualified import")
        seen.add(path)
        parts = path.split("/")[1:]
        directory = fs.open("/", fs.O_RDONLY | fs.O_DIRECTORY | fs.O_NOFOLLOW)
        try:
            validate(fs.fstat(directory), stat.S_IFDIR, len(parts) == 1)
            # Walk with pinned directory descriptors: even a concurrent parent
            # symlink substitution cannot redirect the subsequent file open.
            for index, component in enumerate(parts[:-1]):
                child = fs.open(component, fs.O_RDONLY | fs.O_DIRECTORY | fs.O_NOFOLLOW, dir_fd=directory)
                fs.close(directory)
                directory = child
                value = fs.fstat(directory)
                validate(value, stat.S_IFDIR, index == len(parts) - 2)
                emit(f"/{'/'.join(parts[:index + 1])}: directory ctime={value.st_ctime:.9f}")
            try:
                value = fs.stat(parts[-1], dir_fd=directory, follow_symlinks=False)
            except FileNotFoundError:
                if imported:
                    raise
                emit("Default config absent; own directory predates start")
                return
            # Reject symlinks, FIFOs and devices BEFORE opening. NOFOLLOW and
            # NONBLOCK also bound a substitution between stat and open.
            validate(value, stat.S_IFREG, True)
            source = fs.open(parts[-1], fs.O_RDONLY | fs.O_NOFOLLOW | fs.O_NONBLOCK, dir_fd=directory)
            try:
                opened = fs.fstat(source)
                validate(opened, stat.S_IFREG, True)
                if (opened.st_dev, opened.st_ino, opened.st_ctime_ns) != (value.st_dev, value.st_ino, value.st_ctime_ns):
                    raise ValueError("Changed input")
                chunks = []
                while True:
                    chunk = fs.read(source, min(65536, budget + 1))
                    if not chunk:
                        break
                    budget -= len(chunk)
                    if budget < 0:
                        raise ValueError("Evidence limit")
                    chunks.append(chunk)
            finally:
                fs.close(source)
        finally:
            fs.close(directory)
        config = tomllib.loads(b"".join(chunks).decode("utf-8"))
        emit(f"{path}: regular file ctime={value.st_ctime:.9f} predates_start=True")
        imports = config.get("imports", [])
        if not isinstance(imports, list):
            raise ValueError("Unqualified imports")
        for entry in imports:
            visit(entry, True)

    visit("/etc/containerd/config.toml")


def main():
    try:
        if len(sys.argv) != 2 or not sys.argv[1].isdigit() or int(sys.argv[1]) <= 0:
            raise ValueError()
        proc = f"/proc/{int(sys.argv[1])}"
        with open(f"{proc}/cmdline", "rb") as source:
            argv = source.read(4096).split(b"\0")
        argv = [arg for arg in argv if arg]
        exe = os.readlink(f"{proc}/exe")
        if len(argv) != 1 or argv[0].split(b"/")[-1] != b"containerd" or not exe.startswith("/") or not exe.endswith("/containerd"):
            raise ValueError()
        with open(f"{proc}/stat", encoding="utf-8") as source:
            value = source.read(4096)
        ticks = int(value[value.rfind(")") + 2:].split()[19])
        with open("/proc/stat", encoding="utf-8") as source:
            boot = next(int(line.split()[1]) for line in source if line.startswith("btime "))
        started = boot + ticks / os.sysconf("SC_CLK_TCK")
        print(f"containerd_pid={sys.argv[1]} argv=flagless-containerd exe={exe} reconstructed_start={started:.6f}")
        inspect_configuration(started)
    except Exception:
        print("Config provenance unavailable; do not publish raw config diagnostics", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
