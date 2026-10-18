import { describe, expect, it } from "vitest";
import { BlockedUrlError, assertFetchable, checkUrl, isPublicAddress } from "../../collector/lib/netguard";

describe("isPublicAddress", () => {
  it("accepts public IPv4 and IPv6", () => {
    for (const ip of ["8.8.8.8", "151.101.1.69", "2606:4700::6810:84e5", "2a00:1450:4001:80b::200e"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("rejects loopback, private, link-local, CGNAT, multicast and reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "127.255.255.255", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.1", "198.18.0.1", "203.0.113.5"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("172.32.0.1")).toBe(true);
  });

  it("rejects IPv6 loopback, unspecified, unique-local, link-local, multicast, documentation and mapped private addresses", () => {
    for (const ip of ["::1", "::", "0:0:0:0:0:0:0:1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });

  it("rejects things that are not addresses", () => {
    expect(isPublicAddress("example.com")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("checkUrl", () => {
  it("allows ordinary web URLs", () => {
    expect(checkUrl("https://feeds.feedburner.com/TheHackersNews").literal).toBeNull();
    expect(checkUrl("http://93.184.216.34/x").literal).toBe("93.184.216.34");
  });

  it("blocks other schemes, credentials, local names and private literals", () => {
    const bad = [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "javascript:alert(1)",
      "https://user:pw@example.com/",
      "http://localhost/",
      "http://localhost:3000/",
      "http://foo.localhost/",
      "http://printer.local/",
      "http://db.internal/",
      "http://router/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://0x7f000001/",
    ];
    for (const u of bad) expect(() => checkUrl(u), u).toThrow(BlockedUrlError);
  });
});

describe("assertFetchable", () => {
  it("accepts a name that resolves only to public addresses", async () => {
    await expect(assertFetchable("https://example.com/feed", async () => ["93.184.216.34", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"])).resolves.toBeInstanceOf(URL);
  });

  it("rejects a name with any private address among its answers (DNS rebinding, split horizon)", async () => {
    await expect(assertFetchable("https://evil.example/", async () => ["93.184.216.34", "10.0.0.5"])).rejects.toThrow(BlockedUrlError);
    await expect(assertFetchable("https://meta.example/", async () => ["169.254.169.254"])).rejects.toThrow(BlockedUrlError);
    await expect(assertFetchable("https://nowhere.example/", async () => [])).rejects.toThrow(BlockedUrlError);
  });

  it("does not resolve IP literals", async () => {
    let called = false;
    await assertFetchable("http://93.184.216.34/", async () => {
      called = true;
      return [];
    });
    expect(called).toBe(false);
  });
});
