"""In-memory filesystem probes. Never opens a host config, socket or FIFO."""
import posixpath
import runpy
import stat
import sys
import contextlib
import io
import math
from types import SimpleNamespace

module = runpy.run_path("scripts/release/config-evidence.py")
inspect = module["inspect_configuration"]
case = sys.argv[1]

if case in ("generic", "argv"):
    main = module["main"]
    def fake_open(path, *args, **kwargs):
        if path.endswith("cmdline"):
            return io.BytesIO(b"/usr/bin/containerd\0" + (b"--token\0PRIVATE_CONFIG_MARKER\0" if case == "argv" else b""))
        if path == "/proc/stat":
            return io.StringIO("btime 1000\n")
        return io.StringIO("812 (containerd) S " + "0 " * 18 + "10000 0")
    def fail_inspection(*args):
        raise ValueError("PRIVATE_CONFIG_MARKER")
    main.__globals__.update(open=fake_open, os=SimpleNamespace(readlink=lambda _: "/usr/bin/containerd", sysconf=lambda _: 100),
                            inspect_configuration=fail_inspection if case == "generic" else lambda _: None)
    sys.argv = ["config-evidence.py", "812"]
    stdout, stderr = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        result = main()
    assert result == 1
    assert "PRIVATE_CONFIG_MARKER" not in stdout.getvalue() + stderr.getvalue()
    assert stderr.getvalue() == "Config provenance unavailable; do not publish raw config diagnostics\n"
    if case == "argv":
        assert not stdout.getvalue(), "unvalidated argv emitted"
    print("owner evidence probe passed")
    sys.exit(0)


class Filesystem:
    O_RDONLY, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK = 0, 1, 2, 4

    def __init__(self):
        self.descriptors = {}
        self.opened_files = []
        self.count = 0
        self.offsets = {}

    def path(self, name, directory=None):
        return name if directory is None else posixpath.join(self.descriptors[directory], name)

    def stat(self, name, dir_fd=None, follow_symlinks=False):
        assert not follow_symlinks
        path = self.path(name, dir_fd)
        kind = stat.S_IFREG if path.endswith(".toml") else stat.S_IFDIR
        if path.endswith("import.toml"):
            kind = {"symlink": stat.S_IFLNK, "fifo": stat.S_IFIFO}.get(case, kind)
        if path == "/etc" and case == "ancestor":
            kind = stat.S_IFLNK
        ctime = 1792610946.53
        if path == "/etc":
            ctime = 1792823033.81
        if path == "/":
            ctime = 1792823033.81 if case == "root-anchor" else 1792610207.998
        if path == "/etc/service-config" and case == "ancestor-rename":
            ctime = 1792823033.81
        if path == "/etc" and case == "unknown-time":
            ctime = float("nan")
        return SimpleNamespace(st_mode=kind | 0o755, st_uid=0, st_ctime=ctime,
                               st_dev=1, st_ino=hash(path), st_ctime_ns=int(ctime * 1e9) if math.isfinite(ctime) else 0)

    def open(self, name, flags, dir_fd=None):
        path = self.path(name, dir_fd)
        if not path.endswith(".toml"):
            assert flags & self.O_DIRECTORY and flags & self.O_NOFOLLOW
            if case == "ancestor" and path == "/etc":
                raise OSError("symlink refused")
        else:
            self.opened_files.append(path)
            assert flags & self.O_NOFOLLOW and flags & self.O_NONBLOCK
        self.count += 1
        self.descriptors[self.count] = path
        return self.count

    def fstat(self, fd):
        value = self.stat(self.descriptors[fd])
        if case == "swap" and self.descriptors[fd].endswith("import.toml"):
            value.st_ino += 1
        return value

    def read(self, fd, size):
        path = self.descriptors[fd]
        text = b"version = 3"
        if path.endswith("config.toml"):
            text = b"imports = ['/etc/containerd/import.toml']"
            if case == "normalized":
                text = b"imports = ['/etc/containerd/../containerd/import.toml']"
            if case == "control":
                text = b"imports = ['/etc/containerd/bad name.toml']"
            if case == "ancestor-rename":
                text = b"imports = ['/etc/service-config/containerd/extra.toml']"
        if case == "limit" and path.endswith("import.toml"):
            return b" " * size
        offset = self.offsets.get(fd, 0)
        self.offsets[fd] = offset + size
        return text[offset:offset + size]

    def close(self, fd):
        del self.descriptors[fd]


fs = Filesystem()
error = None
try:
    inspect(1792650086.62, fs, lambda _: None)
except Exception as caught:
    error = caught
if case == "accept":
    assert error is None, repr(error)
    assert len(fs.opened_files) == 2
else:
    assert error is not None, "unqualified input accepted"
    if case in ("symlink", "fifo", "ancestor", "normalized", "control"):
        assert "/etc/containerd/import.toml" not in fs.opened_files, "unqualified import opened"
assert not fs.descriptors, "descriptor leaked"
print("owner evidence probe passed")
