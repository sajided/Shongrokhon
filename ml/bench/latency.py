"""TC-P2-MLAPI-05/06: latency against a running service.

    python bench/latency.py --url http://localhost:8710 --sequential 1000
    python bench/latency.py --url http://localhost:8710 --concurrency 100 --duration 300
Times are client round trips inside the Docker network, so they include HTTP
overhead (an upper bound on server time).
"""
import argparse
import asyncio
import multiprocessing as mp
import json
import os
import socket
import statistics
import time

import httpx

# Disable Nagle on the client: with keep-alive, httpx's separate header/body
# writes otherwise wait ~40 ms for a delayed ACK on every request.
NODELAY = [(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)]

PAYLOAD = {"amount": 500.0, "payer_txn_count_90d": 40.0, "payer_median_amount_90d": 450.0, "amount_to_median": 1.1,
           "payer_hour_share": 0.4, "payer_merchant_prior_count": 20.0, "merchant_distinct_payers_30d": 30.0}


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def sequential(url, n, headers):
    times = []
    with httpx.Client(base_url=url, headers=headers, timeout=5,
                      transport=httpx.HTTPTransport(socket_options=NODELAY)) as c:
        for _ in range(n):
            t = time.perf_counter()
            r = c.post("/score", json=PAYLOAD)
            r.raise_for_status()
            times.append((time.perf_counter() - t) * 1000)
    return {"requests": n, "p50_ms": round(pct(times, 50), 2), "p95_ms": round(pct(times, 95), 2),
            "p99_ms": round(pct(times, 99), 2), "mean_ms": round(statistics.mean(times), 2)}


async def load(url, concurrency, duration, headers):
    times, errors = [], 0
    deadline = time.perf_counter() + duration

    async def worker(c):
        nonlocal errors
        while time.perf_counter() < deadline:
            t = time.perf_counter()
            try:
                r = await c.post("/score", json=PAYLOAD)
                if r.status_code != 200:
                    errors += 1
            except httpx.HTTPError:
                errors += 1
            times.append((time.perf_counter() - t) * 1000)

    async with httpx.AsyncClient(base_url=url, headers=headers, timeout=5,
                                 transport=httpx.AsyncHTTPTransport(socket_options=NODELAY,
                                                                    limits=httpx.Limits(max_connections=concurrency))) as c:
        await asyncio.gather(*(worker(c) for _ in range(concurrency)))
    return {"requests": len(times), "errors": errors, "error_rate": errors / max(len(times), 1),
            "p95_ms": round(pct(times, 95), 2), "p99_ms": round(pct(times, 99), 2)}


def _load_worker(args):
    url, concurrency, duration, headers, think = args
    times, errors = [], 0

    async def run():
        nonlocal errors
        deadline = time.perf_counter() + duration

        async def worker(c):
            nonlocal errors
            while time.perf_counter() < deadline:
                t = time.perf_counter()
                try:
                    r = await c.post("/score", json=PAYLOAD)
                    if r.status_code != 200:
                        errors += 1
                except httpx.HTTPError:
                    errors += 1
                times.append((time.perf_counter() - t) * 1000)
                if think:
                    await asyncio.sleep(think)

        transport = httpx.AsyncHTTPTransport(socket_options=NODELAY, limits=httpx.Limits(max_connections=concurrency))
        async with httpx.AsyncClient(base_url=url, headers=headers, timeout=5, transport=transport) as c:
            await asyncio.gather(*(worker(c) for _ in range(concurrency)))

    asyncio.run(run())
    return times, errors


def load_multi(url, concurrency, duration, headers, processes, think=0.0):
    """One Python client process saturates a core at ~100 req/s, so the users are
    spread over several processes; otherwise the client is what gets measured."""
    per = [concurrency // processes + (1 if i < concurrency % processes else 0) for i in range(processes)]
    with mp.Pool(processes) as pool:
        parts = pool.map(_load_worker, [(url, n, duration, headers, think) for n in per])
    times = [t for ts, _ in parts for t in ts]
    errors = sum(e for _, e in parts)
    return {"users": concurrency, "think_s": think, "client_processes": processes, "requests": len(times), "rps": round(len(times) / duration),
            "errors": errors, "error_rate": errors / max(len(times), 1),
            "p50_ms": round(pct(times, 50), 2), "p95_ms": round(pct(times, 95), 2), "p99_ms": round(pct(times, 99), 2)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8710")
    ap.add_argument("--sequential", type=int, default=0)
    ap.add_argument("--concurrency", type=int, default=0)
    ap.add_argument("--duration", type=int, default=300)
    ap.add_argument("--processes", type=int, default=4)
    ap.add_argument("--think", type=float, default=0.0, help="pause per user between requests (s); 0 = saturation")
    a = ap.parse_args()
    headers = {"Authorization": f"Bearer {os.environ['ML_SERVICE_TOKEN']}"}
    if a.sequential:
        print(json.dumps({"sequential": sequential(a.url, a.sequential, headers)}))
    if a.concurrency:
        print(json.dumps({"load": load_multi(a.url, a.concurrency, a.duration, headers, a.processes, a.think)}))
