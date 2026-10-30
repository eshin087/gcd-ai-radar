import { describe, expect, it } from "vitest";
import { busy, dispatchCollector } from "../../worker/src/dispatch";

/** The Worker's collector clock (worker/src/dispatch.ts), against a fake GitHub API. */

type Call = { url: string; init?: RequestInit };

function fakeGitHub(runs: { status: string }[], dispatchStatus = 204) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/dispatches")) return new Response(null, { status: dispatchStatus });
    return Response.json({ total_count: runs.length, workflow_runs: runs });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("busy", () => {
  it("is true while a run waits or works and false once every run is done", () => {
    expect(busy([{ status: "completed" }, { status: "completed" }])).toBe(false);
    expect(busy([])).toBe(false);
    for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) expect(busy([{ status: "completed" }, { status }])).toBe(true);
  });
});

describe("dispatchCollector", () => {
  it("starts collect.yml on main with the token when no run is active", async () => {
    const gh = fakeGitHub([{ status: "completed" }]);
    await expect(dispatchCollector("tok", gh.fetcher)).resolves.toBe("dispatched");
    expect(gh.calls).toHaveLength(2);
    const [list, post] = gh.calls;
    expect(list?.url).toBe("https://api.github.com/repos/eshin087/gcd-ai-radar/actions/workflows/collect.yml/runs?per_page=5");
    expect(post?.url).toBe("https://api.github.com/repos/eshin087/gcd-ai-radar/actions/workflows/collect.yml/dispatches");
    expect(post?.init?.method).toBe("POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ ref: "main" });
    expect((post?.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("skips the tick while a run is queued or running", async () => {
    const gh = fakeGitHub([{ status: "in_progress" }, { status: "completed" }]);
    await expect(dispatchCollector("tok", gh.fetcher)).resolves.toBe("busy");
    expect(gh.calls).toHaveLength(1);
  });

  it("throws when GitHub refuses the dispatch or the list", async () => {
    await expect(dispatchCollector("tok", fakeGitHub([], 403).fetcher)).rejects.toThrow("dispatch answered 403");
    const denied = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await expect(dispatchCollector("tok", denied)).rejects.toThrow("runs list answered 401");
  });
});
