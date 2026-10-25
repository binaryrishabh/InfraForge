// Representative Linux schema-4 subset, NOT an observed production dump.
// Source revision b7a25261e029d68978bbf290df0a62fc819b3c51 in containerd/containerd:
// version/version.go; cmd/containerd/command/config.go; cmd/containerd/server/config/config.go;
// plugins/server/grpc/plugin.go; plugins/snapshots/overlay/plugin/plugin.go.
// Other executable plugin defaults are deliberately omitted here. At runtime the
// complete config default/dump plugin maps must match, including unlisted plugins.
export const containerd242 = `version = 4
root = '/var/lib/containerd'
state = '/run/containerd'
temp = ''
disabled_plugins = []
required_plugins = []
oom_score = 0
imports = ['/etc/containerd/conf.d/*.toml']
[debug]
level = ''
format = ''
[cgroup]
path = ''
[plugins.'io.containerd.server.v1.grpc']
address = '/run/containerd/containerd.sock'
uid = 0
gid = 0
max_recv_message_size = 16777216
max_send_message_size = 16777216
[plugins.'io.containerd.snapshotter.v1.overlayfs']
root_path = ''
upperdir_label = false
sync_remove = false
slow_chown = false
mount_options = []
`;
