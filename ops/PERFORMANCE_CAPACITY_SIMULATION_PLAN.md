# PeAS performance and capacity simulation plan

This plan defines reproducible simulations for evaluating simultaneous use of
PeAS. It is a test protocol, not a statement of measured capacity. Do not
publish a supported-user figure until the corresponding run has been completed
and its evidence has been retained.

## 1. Research questions

The simulations answer the following questions:

1. How many simultaneous users can the tested configuration serve while
   meeting the response-time and reliability criteria below?
2. Which resource becomes limiting first: CPU, RAM, database connections, disk
   I/O, network throughput, or a background-worker queue?
3. Does interactive use remain acceptable while uploads, ClamAV scans, OCR,
   media processing, backup, or historical import work is active?
4. Is 16 GB sufficient, and what measurable benefit is provided by 24 GB and
   32 GB RAM on otherwise identical virtual machines?
5. How quickly does the system recover after a short traffic spike?

## 2. Safety and validity controls

- Run destructive, upload, import, and saturation tests only on an isolated
  staging environment with production-equivalent images and configuration.
- Never run the breakpoint test against production.
- Use generated test accounts and non-sensitive fixture documents. Do not copy
  real account credentials, request contents, or restricted research into the
  load-test dataset.
- Use the same application image digest, PostgreSQL version, VM CPU allocation,
  storage class, network path, and dataset for every RAM comparison.
- Disable unrelated VM workloads. Run the load generator from a separate host
  so it does not consume the server resources being measured.
- Synchronize clocks on the server, database, and load-generator hosts.
- Warm the system before measured runs, but restore the same database and
  storage snapshot before each configuration series.
- Perform at least three measured repetitions per scenario and report the
  median together with the range. A single run is not sufficient evidence.
- Stop a run if the host becomes unresponsive, free disk falls below 20 GiB,
  memory remains above 95 percent for two minutes, or failures exceed 10
  percent for two consecutive minutes.

## 3. Test environment matrix

Use the initial CPU recommendation of 8 vCPUs and test these RAM allocations:

| Configuration | vCPU | RAM | Purpose |
| --- | ---: | ---: | --- |
| C16 | 8 | 16 GB | Minimum production candidate |
| C24 | 8 | 24 GB | Recommended initial configuration |
| C32 | 8 | 32 GB | Bulk-import/concurrent-processing candidate |

Record the CPU model and Proxmox CPU type, storage medium and cache mode,
allocated and actually available RAM, operating system, Docker version,
container image digests, network link speed, and whether memory ballooning is
enabled. Do not compare configurations if any of these factors changed without
disclosing the change.

Test against at least two dataset sizes when feasible:

| Dataset | Minimum contents | Purpose |
| --- | --- | --- |
| D1 | 5,000 research records and representative 19 MB files | Initial/pilot corpus |
| D2 | 30,000 research records and representative 19 MB files | Thirty-year planning scenario at 1,000 papers/year |

Fixture documents should approximate the observed mix of text PDFs and scanned
PDFs. A dataset made only of small text PDFs does not exercise realistic disk,
ClamAV, preview, download, or OCR behavior.

## 4. User model and workload mixes

A virtual user represents one active browser session, not one registered user.
Add randomized think time of 2--8 seconds between ordinary actions so the test
does not model every person clicking continuously.

### S1: Public discovery

Use this mix to measure the common read workload:

| Action | Share |
| --- | ---: |
| Open public page or news listing | 25% |
| Search or request suggestions | 35% |
| Open research metadata/details | 25% |
| Preview or download an approved document | 15% |

Use varied search terms, categories, result pages, and document IDs. Do not use
one URL exclusively because intermediary and operating-system caches can make
the result unrepresentative.

### S2: Authenticated research use

Model authenticated users reading research and maintaining their personal
library or annotations:

| Action | Share |
| --- | ---: |
| Search and open details | 45% |
| Preview/download an authorized document | 25% |
| Read annotation/library state | 20% |
| Create or update permitted user state | 10% |

Provision a pool of test accounts so independent virtual users do not
overwrite the same record. Authentication setup must occur before the measured
interval unless sign-in performance is itself the subject of a separate test.

### S3: Administrative ingestion

Run 2, 5, and 10 simultaneous administrative workflows using representative
19 MB fixtures. Each workflow uploads a document, creates or updates metadata,
submits it for the intended review path, and polls only at a realistic interval
for scanning or processing status. Verify after the run that every accepted
upload has exactly one expected database record and stored file.

Do not repeatedly upload one identical filename if production normally uses
different papers. Include scanned documents that invoke OCR as well as text
PDFs that can be processed without OCR.

### S4: Mixed institutional workload

This is the primary capacity scenario. Allocate virtual users as follows:

| Activity | Virtual-user share |
| --- | ---: |
| Public discovery | 60% |
| Authenticated research use | 25% |
| Preview/download-heavy sessions | 10% |
| Administrative ingestion | 5%, with at least 2 and at most 10 uploaders |

Run the mix once with background queues empty and once while OCR and ClamAV are
processing a controlled backlog of 19 MB documents.

### S5: Historical bulk import

Import batches representative of the migration process while maintaining 25
and then 50 mixed interactive users. Test at least 100, 500, and 1,000 papers
per batch, or the largest safe batch supported by the approved importer.
Measure import throughput, rejected records, duplicate behavior, queue depth,
temporary disk growth, and the time until all background work completes.

This scenario determines whether historical import should be performed during
a maintenance window. It must not be represented merely by sending thousands
of concurrent browser uploads if the real migration uses a controlled importer.

### S6: Backup interference

Establish a steady 50-user S4 workload, then start the documented backup job.
Compare interactive latency, disk I/O, backup duration, staging-space peak, and
Restic repository growth with a baseline run that has no backup. Repeat with a
representative corpus large enough to expose whole-volume archive costs.

### S7: Spike and recovery

Hold 25 mixed users for 10 minutes, increase rapidly to 100 users for 5
minutes, and return to 25 for 15 minutes. The system passes recovery only if
latency, error rate, database connections, memory, and worker queues return
toward their pre-spike range without restarting services or losing accepted
work.

### S8: Breakpoint test

On isolated staging only, begin at 10 mixed users and increase through 25, 50,
100, 150, and 200. Hold each stage for 10 minutes. Stop at the first stage that
violates a mandatory acceptance criterion for two consecutive minutes. Repeat
the preceding successful stage for 30 minutes to establish the sustained
capacity candidate.

The breakpoint is specific to the tested workload, dataset, network, and
hardware. It is not the number of people who may have accounts.

## 5. Execution sequence

For each combination of C16, C24, C32 and the selected dataset:

1. Restore the approved starting snapshot and confirm identical row and file
   counts.
2. Start server, database, container, disk, and network monitoring.
3. Warm up with 10 public-discovery users for 10 minutes; exclude warm-up data.
4. Run S1 at 10, 25, 50, and 100 users for 15 minutes per stage.
5. Run S2 at the same stages with separate authenticated accounts.
6. Run S3 at 2, 5, and 10 ingestion workflows.
7. Run S4 at 25, 50, and 100 total users, first without and then with worker
   backlog. Hold each stage for at least 30 minutes.
8. Run S5 and S6 after restoring the appropriate corpus snapshot.
9. Run S7, followed by S8 only if the environment remains healthy.
10. Allow queues to drain, verify database/file consistency, and record any
    service restart or out-of-memory event.
11. Repeat measured runs at least three times.

Randomize scenario order across repeated configuration series where practical
to reduce bias from cache warmth and host conditions.

## 6. Measurements

Collect metrics at intervals of 5--15 seconds and retain raw time-series data:

| Area | Required measurements |
| --- | --- |
| HTTP | Request count, throughput, status code, error reason, median, p95 and p99 latency by action |
| Host | CPU utilization, load, available RAM, paging/swap, disk use, IOPS, latency and network throughput |
| Containers | CPU, current and peak memory, restart count and health status for every service |
| PostgreSQL | Active/queued connections, transaction rate, slow queries, lock waits, cache-hit ratio and database size |
| Workers | Queue depth, oldest-job age, completion rate, failures and processing duration |
| Storage | Live corpus size, generated data, temporary peak, backup staging peak and restore-volume peak |
| Backup | Snapshot duration, bytes read, bytes added after deduplication, repository size and integrity result |
| Correctness | Accepted uploads, completed records, checksum mismatches, missing files and duplicate records |

Report both server-side processing latency and end-to-end download/upload time.
Large file transfer duration is affected by network bandwidth and must not be
misattributed entirely to application CPU or RAM.

## 7. Acceptance criteria

These are initial research criteria and must be approved before testing:

| Criterion | Required result |
| --- | --- |
| Availability | At least 99% successful requests during each steady measured stage |
| Ordinary interactions | p95 response time no more than 2 seconds |
| Search | p95 response time no more than 3 seconds |
| First response for authorized preview/download | p95 no more than 3 seconds; transfer time reported separately |
| Upload API response | p95 no more than 5 seconds, excluding asynchronous OCR completion |
| CPU | No sustained host utilization above 80% for more than 5 minutes |
| Memory | No out-of-memory termination and no sustained allocation above 85% for more than 5 minutes |
| Paging | No sustained paging that coincides with criterion violations |
| Workers | Queue drains after the offered workload ends; oldest-job age does not grow indefinitely |
| Correctness | No lost accepted upload, unauthorized disclosure, corrupt file, or database/file mismatch |
| Recovery | Returns toward the pre-spike latency/error range within 10 minutes after S7 |

Security and correctness criteria are mandatory regardless of response time.
A configuration that is fast but loses data or bypasses authorization fails.

## 8. Interpretation and hardware decision

For each configuration, define supported concurrency as the highest 30-minute
S4 stage that passes every mandatory criterion in all three repetitions. Apply
an operational margin: the recommended routine limit should not exceed 70
percent of that demonstrated stage until longer production observations exist.

Use the C16/C24/C32 comparison as follows:

- Select 16 GB only if C16 passes the required sustained workload without
  paging, out-of-memory events, or material queue growth and retains at least
  15 percent memory headroom.
- Select 24 GB when it passes the required workload and materially reduces
  paging, latency, or worker backlog compared with C16.
- Select 32 GB for the historical-import period when C24 fails under concurrent
  import/OCR workloads or C32 provides the required safety headroom.
- If all three configurations fail while memory remains healthy, investigate
  CPU, storage I/O, database/query, connection-pool, or network limits instead
  of assuming that more RAM is the solution.

Do not extrapolate linearly beyond the measured user count. Queueing effects,
database contention, cache behavior, and network saturation are nonlinear.

## 9. Results record

Complete one row per measured stage and attach graphs and raw artifacts:

| Field | Recorded value |
| --- | --- |
| Date and run ID | |
| Scenario, configuration and dataset | |
| Image and migration identifiers | |
| Concurrent users and duration | |
| Workload/action mix | |
| Requests/second and success rate | |
| Median, p95 and p99 latency | |
| Peak host/container memory and paging | |
| Average/peak CPU | |
| Disk and network measurements | |
| PostgreSQL connections, waits and slow queries | |
| Peak worker queue and drain time | |
| Backup/import throughput and space growth | |
| Correctness verification | |
| Criterion violations and observations | |
| Pass/fail | |

The research paper should distinguish projected scenarios from measured
results, describe the dataset and action mix, disclose all hardware and test
conditions, and report unfavorable results as well as successful stages.
