// test-url.ts
const candidateUrls = [
  "https://get.enterprisedb.com/postgresql/postgresql-17.10-2-windows-x64-binaries.zip",
  "https://get.enterprisedb.com/postgresql/postgresql-17.2-1-windows-x64-binaries.zip",
  "https://get.enterprisedb.com/postgresql/postgresql-17.0-1-windows-x64-binaries.zip",
  "https://get.enterprisedb.com/postgresql/postgresql-18.4-2-windows-x64-binaries.zip",
  "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip",
];

for (const url of candidateUrls) {
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" } });
    console.log(`URL ${url}: status=${res.status}, size=${res.headers.get("content-length")}, type=${res.headers.get("content-type")}`);
  } catch (e) {
    console.log(`URL ${url} error:`, e);
  }
}
