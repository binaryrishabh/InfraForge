const port = process.argv[2];
if (!port || !/^\d+$/.test(port)) process.exit(1);
try {
  const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(5000) });
  const body = await response.json() as { success?: boolean; release?: { sha?: string } } | null;
  if (!response.ok || !body?.success || body.release?.sha !== process.env.RELEASE_SHA) process.exit(1);
} catch { process.exit(1); }
