// ============================================================
// Dashboard — data loading + welcome banner + animated counters
// ============================================================

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Animate a number from current to target over ~900ms
function animateCount(el, target) {
    if (!el) return;
    const safeTarget = Number.isFinite(Number(target)) ? Number(target) : 0;
    if (REDUCED_MOTION) {
        el.textContent = safeTarget.toLocaleString();
        el.dataset.counter = String(safeTarget);
        return;
    }
    const start = Number(el.dataset.counter || 0);
    const duration = 900;
    const startTime = performance.now();
    const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

    function tick(now) {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = easeOutExpo(progress);
        const value = Math.round(start + (safeTarget - start) * eased);
        el.textContent = value.toLocaleString();
        if (progress < 1) requestAnimationFrame(tick);
        else el.dataset.counter = String(safeTarget);
    }
    requestAnimationFrame(tick);
}

// Deterministic palette index 0..5 from a string
function hashPalette(str) {
    let h = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 6;
}

function getInitials(fullName) {
    if (!fullName) return '?';
    const parts = String(fullName).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase() || '?';
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// ============================================================
// Welcome Banner — time-aware greeting + username + date
// ============================================================
function updateWelcomeBanner() {
    const greetingPrefix = document.getElementById('welcome-greeting-prefix');
    const usernameEl = document.getElementById('welcome-username');
    const dateEl = document.getElementById('welcome-date');

    const hour = new Date().getHours();
    let greeting = 'Welcome back';
    if (hour < 5) greeting = 'Good evening';
    else if (hour < 12) greeting = 'Good morning';
    else if (hour < 18) greeting = 'Good afternoon';
    else greeting = 'Good evening';

    if (greetingPrefix) greetingPrefix.textContent = greeting;

    if (dateEl) {
        const opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
        dateEl.textContent = new Date().toLocaleDateString(undefined, opts);
    }

    if (usernameEl) {
        let name = 'there';
        try {
            const raw = sessionStorage.getItem('userInfo') || localStorage.getItem('userInfo');
            if (raw) {
                const u = JSON.parse(raw);
                name = u.username || u.first_name || 'there';
            }
        } catch (_) { /* ignore */ }
        usernameEl.textContent = name;

        // Try to enrich with profile full name (mirrors sidebar logic)
        try {
            const raw = sessionStorage.getItem('userInfo') || localStorage.getItem('userInfo');
            if (raw) {
                const u = JSON.parse(raw);
                if (u && u.id) {
                    fetch(`/api/user/profile?userId=${encodeURIComponent(u.id)}`, { credentials: 'include' })
                        .then(r => r.ok ? r.json() : null)
                        .then(profile => {
                            if (!profile) return;
                            const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
                            if (fullName) usernameEl.textContent = fullName;
                        })
                        .catch(() => {});
                }
            }
        } catch (_) { /* ignore */ }
    }
}

// ============================================================
// Works summary — counts by category
// ============================================================
async function updateWorksSummary() {
    try {
        const categoryCounts = { thesis: 0, dissertation: 0, confluence: 0, synergy: 0 };
        const countedDocumentIds = new Set();

        let regularDocuments = [];
        try {
            const regularResponse = await fetch('/api/documents?limit=1000');
            if (regularResponse.ok) {
                const regularData = await regularResponse.json();
                regularDocuments = regularData.documents || [];
            }
        } catch (_) { /* ignore */ }

        regularDocuments.forEach(doc => {
            if (!doc.id) return;
            if (doc.is_compiled === true || doc.is_parent === true) return;
            if (countedDocumentIds.has(doc.id)) return;
            const docType = (doc.document_type || '').toLowerCase();
            if (categoryCounts.hasOwnProperty(docType)) {
                categoryCounts[docType]++;
                countedDocumentIds.add(doc.id);
            }
        });

        let compiledDocuments = [];
        try {
            const filteredResponse = await fetch('/api/documents?is_compiled=true&limit=1000');
            if (filteredResponse.ok) {
                const filteredData = await filteredResponse.json();
                compiledDocuments = filteredData.documents || [];
            }
        } catch (_) { /* ignore */ }

        compiledDocuments.forEach(doc => {
            if (!doc.id) return;
            if (countedDocumentIds.has(doc.id)) return;
            let docType = (doc.document_type || '').toLowerCase();
            if (!docType && doc.category) docType = doc.category.toLowerCase();
            if (categoryCounts.hasOwnProperty(docType)) {
                categoryCounts[docType]++;
                countedDocumentIds.add(doc.id);
            } else if (docType.includes('confluence')) {
                categoryCounts.confluence++;
                countedDocumentIds.add(doc.id);
            } else if (docType.includes('synergy')) {
                categoryCounts.synergy++;
                countedDocumentIds.add(doc.id);
            }
        });

        if (countedDocumentIds.size === 0) {
            try {
                const categoriesResponse = await fetch('/api/categories');
                if (categoriesResponse.ok) {
                    const categories = await categoriesResponse.json();
                    categories.forEach(category => {
                        const count = Number(category.count) || 0;
                        const name = (category.name || '').toLowerCase();
                        if (categoryCounts.hasOwnProperty(name)) categoryCounts[name] = count;
                    });
                }
            } catch (_) { /* ignore */ }
        }

        updateCategoryUI(categoryCounts);
    } catch (error) {
        document.querySelectorAll('.tile-count').forEach(el => { el.textContent = '—'; });
        const totalCountElement = document.querySelector('.total-works-card .total-count');
        if (totalCountElement) totalCountElement.textContent = '—';
    }
}

// Update the works-by-category tiles, stacked bar, total works KPI, and banner quickstat
function updateCategoryUI(categoryCounts) {
    const totalWorks = Object.values(categoryCounts).reduce((sum, count) => sum + count, 0);

    // Per-category tile updates
    document.querySelectorAll('.category-tile').forEach(tile => {
        const category = tile.dataset.category;
        if (!category) return;
        const count = categoryCounts[category] || 0;
        const countEl = tile.querySelector('.tile-count');
        const barFill = tile.querySelector('.tile-bar-fill');
        const percentEl = tile.querySelector('.tile-percent');

        if (countEl) animateCount(countEl, count);
        const percent = totalWorks ? Math.round((count / totalWorks) * 100) : 0;
        if (barFill) barFill.style.width = `${percent}%`;
        if (percentEl) percentEl.textContent = `${percent}% of total`;
    });

    // Stacked bar segments on Total Works KPI
    const stackBar = document.querySelector('.works-stack-bar');
    if (stackBar) {
        const segs = ['confluence', 'dissertation', 'thesis', 'synergy'];
        segs.forEach(seg => {
            const segEl = stackBar.querySelector(`.seg-${seg}`);
            if (!segEl) return;
            const percent = totalWorks ? (categoryCounts[seg] / totalWorks) * 100 : 0;
            segEl.style.width = `${percent}%`;
        });
    }

    // Total works KPI
    const totalCountElement = document.querySelector('.total-works-card .total-count');
    if (totalCountElement) animateCount(totalCountElement, totalWorks);

    // Banner quickstat
    const quickWorks = document.getElementById('quickstat-works');
    if (quickWorks) animateCount(quickWorks, totalWorks);
}

// ============================================================
// Top Authors — list + KPI + initials fallback
// ============================================================
async function updateTopAuthors() {
    try {
        const response = await fetch('/api/author-visits/stats?include_breakdown=true&nocache=' + Date.now());

        if (!response.ok) {
            const allAuthorsResponse = await fetch('/api/authors/all');
            if (!allAuthorsResponse.ok) {
                renderAuthorsEmptyState('No author data available yet.');
                return;
            }
            const allAuthorsData = await allAuthorsResponse.json();
            const transformedData = {
                topAuthors: (allAuthorsData.authors || []).slice(0, 5).map(author => ({
                    full_name: author.full_name,
                    visit_count: 0,
                    profile_picture: author.profilePicUrl || null,
                    author_id: author.id
                }))
            };
            updateTopAuthorsUI(transformedData, allAuthorsData.authors || []);
            return;
        }

        const data = await response.json();

        let usableData = { topAuthors: [] };
        if (data.topAuthors && data.topAuthors.length > 0) {
            usableData = {
                topAuthors: data.topAuthors.map(author => ({
                    ...author,
                    visit_count: Number(author.visit_count || 0),
                    author_id: author.author_id || author.id
                }))
            };
        } else if (data.authors && data.authors.length > 0) {
            usableData = {
                topAuthors: data.authors.map(author => ({
                    full_name: author.full_name || author.name || 'Unknown Author',
                    visit_count: Number(author.visit_count || author.visits || 0),
                    profile_picture: author.profilePicUrl || author.profile_picture || author.avatar || null,
                    author_id: author.author_id || author.id
                }))
            };
        } else {
            const allAuthorsResponse = await fetch('/api/authors/all');
            if (allAuthorsResponse.ok) {
                const allAuthorsData = await allAuthorsResponse.json();
                usableData = {
                    topAuthors: (allAuthorsData.authors || []).slice(0, 5).map(author => ({
                        full_name: author.full_name || author.name || 'Unknown Author',
                        visit_count: 0,
                        profile_picture: author.profilePicUrl || author.profile_picture || null,
                        author_id: author.id
                    }))
                };
            }
        }

        usableData.topAuthors = usableData.topAuthors.map(author => ({
            ...author,
            visit_count: Number(author.visit_count || 0)
        }));

        // Pull total count for the KPI from the full author list (separate fetch)
        let totalAuthors = usableData.topAuthors.length;
        try {
            const allResp = await fetch('/api/authors/all');
            if (allResp.ok) {
                const allData = await allResp.json();
                if (Array.isArray(allData.authors)) totalAuthors = allData.authors.length;
            }
        } catch (_) { /* ignore */ }

        updateTopAuthorsUI(usableData, null, totalAuthors);
    } catch (error) {
        renderAuthorsEmptyState('Could not load top authors.');
    }
}

function renderAuthorsEmptyState(message) {
    const authorsListContainer = document.querySelector('.authors-list');
    if (!authorsListContainer) return;
    authorsListContainer.innerHTML = `
        <div class="empty-state">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7m-4 0a4 4 0 1 1 8 0a4 4 0 1 1 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <p class="empty-title">No author data yet</p>
            <p class="empty-sub">${message}</p>
        </div>
    `;
}

function buildAvatarElement(author) {
    const picture = author.profile_picture;
    const looksValid = picture && typeof picture === 'string' && picture.trim() !== '' && !picture.includes('default.jpg');
    if (looksValid) {
        const imageDiv = document.createElement('div');
        imageDiv.className = 'author-image';
        const url = picture.startsWith('http') || picture.startsWith('/')
            ? picture
            : `/storage/authors/profile-pictures/${picture}`;
        imageDiv.style.backgroundImage = `url('${url}')`;
        return imageDiv;
    }
    const initialsDiv = document.createElement('div');
    initialsDiv.className = `author-avatar-initials palette-${hashPalette(author.author_id || author.full_name)}`;
    initialsDiv.textContent = getInitials(author.full_name);
    initialsDiv.setAttribute('aria-hidden', 'true');
    return initialsDiv;
}

function updateAuthorAvatarStack(topAuthors, totalAuthors) {
    const stack = document.getElementById('author-avatar-stack');
    if (!stack) return;
    stack.innerHTML = '';
    const sample = (topAuthors || []).slice(0, 3);
    sample.forEach(author => {
        const a = document.createElement('div');
        a.className = 'stack-avatar';
        const picture = author.profile_picture;
        const looksValid = picture && typeof picture === 'string' && picture.trim() !== '' && !picture.includes('default.jpg');
        if (looksValid) {
            const url = picture.startsWith('http') || picture.startsWith('/')
                ? picture
                : `/storage/authors/profile-pictures/${picture}`;
            a.style.backgroundImage = `url('${url}')`;
            a.style.backgroundColor = 'transparent';
        } else {
            a.classList.add(`palette-${hashPalette(author.author_id || author.full_name)}`);
            a.textContent = getInitials(author.full_name);
            // Avatar-stack uses solid brand-soft bg by default; override via inline gradient using palette
            const palettes = [
                'linear-gradient(135deg, #006A4E, #00855f)',
                'linear-gradient(135deg, #2563eb, #4f7df5)',
                'linear-gradient(135deg, #d4a017, #efbb29)',
                'linear-gradient(135deg, #7c3aed, #a86cf5)',
                'linear-gradient(135deg, #e11d48, #f25b7e)',
                'linear-gradient(135deg, #0891b2, #22b9d8)'
            ];
            const idx = hashPalette(author.author_id || author.full_name);
            a.style.backgroundImage = palettes[idx];
            a.style.color = '#E6E6E6';
        }
        stack.appendChild(a);
    });
    if (totalAuthors && totalAuthors > sample.length) {
        const more = document.createElement('a');
        more.className = 'stack-more';
        more.href = '/admin/Components/author-list.html';
        more.title = 'View all authors';
        more.textContent = `+${(totalAuthors - sample.length).toLocaleString()} more`;
        stack.appendChild(more);
    }
}

function updateTopAuthorsUI(data, allAuthors, totalAuthorsHint) {
    const authorsListContainer = document.querySelector('.authors-list');
    if (!authorsListContainer) return;

    authorsListContainer.innerHTML = '';
    const sortedAuthors = [...data.topAuthors].sort((a, b) => (b.visit_count || 0) - (a.visit_count || 0));

    if (sortedAuthors.length === 0) {
        renderAuthorsEmptyState('Once authors are added they will appear here.');
    }

    sortedAuthors.forEach((author, idx) => {
        const authorElement = document.createElement('div');
        authorElement.className = 'author';
        authorElement.style.animationDelay = `${idx * 40}ms`;

        let visitCount = author.visit_count || 0;
        let visitText = visitCount === 1 ? '1 visit' : `${visitCount.toLocaleString()} visits`;

        const avatar = buildAvatarElement(author);

        const nameDiv = document.createElement('div');
        nameDiv.className = 'author-name';
        nameDiv.textContent = author.full_name;

        const visitsDiv = document.createElement('div');
        visitsDiv.className = 'author-visits';
        visitsDiv.textContent = visitText;

        authorElement.appendChild(avatar);
        authorElement.appendChild(nameDiv);
        authorElement.appendChild(visitsDiv);

        // Tooltip (kept from original)
        const tooltip = document.createElement('div');
        tooltip.className = 'author-visits-tooltip';
        tooltip.style.position = 'absolute';
        tooltip.style.display = 'none';
        tooltip.style.backgroundColor = 'rgba(15, 23, 42, 0.92)';
        tooltip.style.color = '#E6E6E6';
        tooltip.style.padding = '0.75rem';
        tooltip.style.borderRadius = '8px';
        tooltip.style.boxShadow = '0 8px 24px rgba(15, 23, 42, 0.2)';
        tooltip.style.fontSize = '0.85rem';
        tooltip.style.zIndex = '1000';
        tooltip.style.width = 'auto';
        tooltip.style.minWidth = '220px';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.backdropFilter = 'blur(8px)';

        let guestCount = Math.round(visitCount * 0.85);
        let userCount = visitCount - guestCount;

        if (author.author_id) {
            tooltip.innerHTML = `<div style="text-align:center;padding:4px;font-size:0.85rem;">Loading visit details...</div>`;
            fetch(`/api/author-visits/${author.author_id}?days=30&nocache=${Date.now()}`)
                .then(r => r.json())
                .then(data => {
                    if (data && data.visitsByType) {
                        guestCount = Number(data.visitsByType.guest || 0);
                        userCount = Number(data.visitsByType.user || 0);
                        const breakdownSum = guestCount + userCount;
                        if (breakdownSum > 0) {
                            visitCount = breakdownSum;
                            visitsDiv.textContent = visitCount === 1 ? '1 visit' : `${visitCount.toLocaleString()} visits`;
                            author.visit_count = visitCount;
                        } else if (data.total > 0) {
                            visitCount = Number(data.total);
                            visitsDiv.textContent = visitCount === 1 ? '1 visit' : `${visitCount.toLocaleString()} visits`;
                            author.visit_count = visitCount;
                            guestCount = Math.round(data.total * 0.85);
                            userCount = data.total - guestCount;
                        }
                    } else if (data && typeof data.total === 'number' && data.total > 0) {
                        guestCount = Math.round(data.total * 0.85);
                        userCount = data.total - guestCount;
                        if (visitCount === 0) {
                            visitCount = data.total;
                            visitsDiv.textContent = visitCount === 1 ? '1 visit' : `${visitCount.toLocaleString()} visits`;
                        }
                    }
                    updateTooltipContent();
                })
                .catch(() => updateTooltipContent());
        } else {
            updateTooltipContent();
        }

        function updateTooltipContent() {
            tooltip.innerHTML = `
                <div style="margin-bottom:0.6rem;font-size:0.95rem;font-weight:600;text-align:center;">${author.full_name}</div>
                <div style="margin-bottom:0.4rem;color:rgba(255,255,255,0.7);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;">Visit Breakdown</div>
                <div style="display:flex;justify-content:space-between;margin-bottom:0.25rem;">
                    <span>Guest</span><strong>${guestCount.toLocaleString()}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;">
                    <span>User</span><strong>${userCount.toLocaleString()}</strong>
                </div>
                <div style="border-top:1px solid rgba(255,255,255,0.18);padding-top:0.5rem;display:flex;justify-content:space-between;">
                    <span>Total</span><strong>${visitCount.toLocaleString()}</strong>
                </div>
            `;
        }

        document.body.appendChild(tooltip);

        let isHovering = false;
        let hideTooltipTimeout = null;

        authorElement.addEventListener('mouseenter', function () {
            isHovering = true;
            if (hideTooltipTimeout) { clearTimeout(hideTooltipTimeout); hideTooltipTimeout = null; }
            const rect = this.getBoundingClientRect();
            const tooltipWidth = 240;
            const leftPosition = rect.left + (rect.width / 2) - (tooltipWidth / 2) + window.scrollX;
            tooltip.style.top = `${rect.bottom + window.scrollY + 10}px`;
            tooltip.style.left = `${leftPosition}px`;
            tooltip.style.display = 'block';
            setTimeout(() => { if (isHovering) tooltip.classList.add('visible'); }, 10);
        });

        authorElement.addEventListener('mouseleave', function () {
            isHovering = false;
            hideTooltipTimeout = setTimeout(() => {
                if (!isHovering) {
                    tooltip.classList.remove('visible');
                    setTimeout(() => { if (!isHovering) tooltip.style.display = 'none'; }, 200);
                }
            }, 100);
        });

        authorsListContainer.appendChild(authorElement);
    });

    // Update KPI card + banner quickstat
    const totalAuthors = totalAuthorsHint || (allAuthors ? allAuthors.length : sortedAuthors.length);
    const kpiCount = document.querySelector('.active-authors-card .active-authors-count');
    if (kpiCount) animateCount(kpiCount, totalAuthors);
    const bannerAuthors = document.getElementById('quickstat-authors');
    if (bannerAuthors) animateCount(bannerAuthors, totalAuthors);

    updateAuthorAvatarStack(sortedAuthors, totalAuthors);
}

// ============================================================
// Total visits (green hero card + banner quickstat)
// ============================================================
async function updateTotalVisits() {
    try {
        const response = await fetch('/api/page-visits/home-stats');
        if (!response.ok) {
            const authorResponse = await fetch('/api/author-visits/stats');
            if (!authorResponse.ok) { renderTotalVisitsEmptyState(); return; }
            const authorData = await authorResponse.json();
            updateTotalVisitsUI(authorData);
            return;
        }
        const data = await response.json();
        updateTotalVisitsUI(data);
    } catch (error) {
        renderTotalVisitsEmptyState();
    }
}

function renderTotalVisitsEmptyState() {
    const totalVisitsElement = document.querySelector('.total-visits-number');
    if (totalVisitsElement) totalVisitsElement.textContent = '—';
    const guestVisitsElement = document.querySelector('.visits-row div:first-child .visit-count');
    if (guestVisitsElement) guestVisitsElement.textContent = '—';
    const userVisitsElement = document.querySelector('.visits-row div:last-child .visit-count');
    if (userVisitsElement) userVisitsElement.textContent = '—';
}

function updateTotalVisitsUI(data) {
    const stats = data && data.stats ? data.stats : {};
    const total = Number(stats.total || 0);
    const guest = Number(stats.guest || 0);
    const user = Number(stats.user || 0);

    const totalVisitsElement = document.querySelector('.total-visits-number');
    if (totalVisitsElement) animateCount(totalVisitsElement, total);

    const guestVisitsElement = document.querySelector('.visits-row div:first-child .visit-count');
    if (guestVisitsElement) animateCount(guestVisitsElement, guest);

    const userVisitsElement = document.querySelector('.visits-row div:last-child .visit-count');
    if (userVisitsElement) animateCount(userVisitsElement, user);

    const visitLabels = document.querySelectorAll('.visit-label');
    if (visitLabels.length >= 2) {
        visitLabels[0].textContent = 'Guest Visits';
        visitLabels[1].textContent = 'User Visits';
    }

    const totalVisitsLabel = document.querySelector('.total-visits > div:nth-child(2)');
    if (totalVisitsLabel) totalVisitsLabel.textContent = 'Total Home Page Visits';

    const banner = document.getElementById('quickstat-visits');
    if (banner) animateCount(banner, total);
}

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Tooltip styles (preserved from original)
    const style = document.createElement('style');
    style.textContent = `
        .most-visited-visits { position: relative; }
        .visits-tooltip, .author-visits-tooltip {
            position: absolute;
            display: none;
            z-index: 1000;
            transition: opacity 0.2s ease-in-out, transform 0.2s ease-out;
            opacity: 0;
            transform: translateY(-4px);
            max-width: 280px;
        }
        .visits-tooltip.visible, .author-visits-tooltip.visible {
            opacity: 1;
            transform: translateY(0);
        }
        .author {
            position: relative;
        }
    `;
    document.head.appendChild(style);

    updateWelcomeBanner();

    setTimeout(() => {
        updateWorksSummary();
        updateTopAuthors();
        updateTotalVisits();
    }, 100);
});
