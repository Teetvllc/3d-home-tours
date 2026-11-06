// Branded footer: "Presented by" (you) + "Listed by" (the listing agent), plus the lead buttons.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const NMLS_LOOKUP = id => `https://www.nmlsconsumeraccess.org/EntityDetails.aspx/INDIVIDUAL/${encodeURIComponent(id)}`;

/** Merge listing branding over config/brand.json defaults, and set the accent color. */
export function applyAccent(L, defaults = {}) {
  const b = L.branding || {};
  const B = {
    presenter: { ...(defaults.presenter || {}), ...(b.presenter || {}) },
    agent: { ...(defaults.agent || {}), ...(b.agent || {}) },
    accent: b.accent || defaults.accent || '#1f6f5c',
    disclaimer: b.disclaimer || defaults.disclaimer || '',
  };
  document.documentElement.style.setProperty('--accent', B.accent);
  return B;
}

/**
 * Where the lead buttons go: your application link if set, otherwise a pre-written email.
 * `home` is the listing address, so the email says which house the buyer was looking at.
 */
export function applyLink(p, home) {
  if (p?.applyUrl) return { href: p.applyUrl, external: true };
  if (p?.email) {
    const subject = `Pre-approval${home ? ` for ${home}` : ''}`;
    const body = `Hi ${String(p.name || '').split(' ')[0] || 'there'},\n\nI was looking at the 3D tour${home ? ` of ${home}` : ''} and I'd like to get pre-approved.\n\nName:\nPhone:\nBest time to reach me:\n`;
    return { href: `mailto:${p.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, external: false };
  }
  if (p?.phone) return { href: `tel:${p.phone.replace(/[^\d+]/g, '')}`, external: false };
  return null;
}

function person(p, role, cls, home) {
  if (!p?.name) return '<div></div>';
  const id = p.nmls ? (cls === 'presenter'
    ? `<a href="${NMLS_LOOKUP(p.nmls)}" target="_blank" rel="noopener">NMLS #${esc(p.nmls)}</a>` : `NMLS #${esc(p.nmls)}`) : '';
  const line1 = [p.title, p.company || p.brokerage].filter(Boolean).map(esc).concat(id ? [id] : [], p.license ? [`Lic. ${esc(p.license)}`] : []).join(' · ');
  const subj = home ? `?subject=${encodeURIComponent(`Question about ${home}`)}` : '';
  const contact = [p.phone && `<a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>`, p.email && `<a href="mailto:${esc(p.email)}${subj}">${esc(p.email)}</a>`,
    p.website && `<a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`].filter(Boolean).join(' · ');
  const avatar = p.photo ? `<img class="avatar" src="${esc(p.photo)}" alt="${esc(p.name)}">` : `<div class="avatar" aria-hidden="true">${esc(initials(p.name))}</div>`;
  const link = cls === 'presenter' ? applyLink(p, home) : null;
  const cta = link ? `<a class="btn primary cta" href="${esc(link.href)}" ${link.external ? 'target="_blank" rel="noopener"' : ''} data-lead="footer">${esc(p.ctaLabel || 'Apply Now')}</a>` : '';
  return `<div class="who ${cls}">${avatar}<div style="min-width:0"><div class="role">${role}</div><strong>${esc(p.name)}</strong>
    ${line1 ? `<div class="sub">${line1}</div>` : ''}${contact ? `<div class="sub">${contact}</div>` : ''}
    ${p.licenses ? `<div class="sub lic">Licensed: ${esc(p.licenses)}</div>` : ''}</div>${cta}</div>`;
}

export function renderFooter(el, B, home = '') {
  el.innerHTML = person(B.presenter, 'Presented by', 'presenter', home) + person(B.agent, 'Listed by', 'agent', home) +
    (B.disclaimer ? `<p class="disclaimer" title="${esc(B.disclaimer)}">${esc(B.disclaimer)}${B.presenter?.nmls ? ` <a href="https://www.nmlsconsumeraccess.org/" target="_blank" rel="noopener">NMLS Consumer Access</a>` : ''}</p>` : '');
  el.querySelector('.disclaimer')?.addEventListener('click', e => { if (e.target.tagName !== 'A') e.currentTarget.classList.toggle('open'); });
}
