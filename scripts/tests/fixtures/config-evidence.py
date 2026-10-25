"""In-memory filesystem probes. Never opens a host config, socket or FIFO."""
import posixpath
import runpy
import stat
import sys
from types import SimpleNamespace

inspect = runpy.run_path("scripts/release/config-evidence.py")["inspect_configuration"]
case = sys.argv[1]


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
            ctime = 1792610207.998
        return SimpleNamespace(st_mode=kind | 0o755, st_uid=0, st_ctime=ctime,
                               st_dev=1, st_ino=hash(path), st_ctime_ns=int(ctime * 1e9))

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
        if case == "limit" and path.endswith("import.toml"):
            return b"a" * size
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
