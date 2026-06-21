const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));

async function loadRepositories() {
  const data = await fetchJson("/api/repositories");
  elements.repositorySelector.insertAdjacentHTML("beforeend", data.repositories.map((repository) =>
    `<option value="${escapeHtml(repository.id)}">${escapeHtml(repository.displayName)}</option>`).join(""));
}

async function refreshDashboard(force = false) {
  setState("loading");
  elements.refreshButton.disabled = true;
  try {
    const params = new URLSearchParams({ days: elements.periodSelector.value });
    if (elements.repositorySelector.value) params.set("repository", elements.repositorySelector.value);
    if (force) params.set("refresh", "true");
    const data = await fetchJson(`/api/executive/briefing?${params}`);
    if (!data.briefing) {
      elements.empty.textContent = data.emptyReason || "No hay evidencia suficiente para generar el briefing.";
      setState("empty");
      return;
    }
    renderBriefing(data);
    setState("content");
  } catch (error) {
    elements.error.textContent = error instanceof Error ? error.message : String(error);
    setState("error");
  } finally {
    elements.refreshButton.disabled = false;
  }
}

function renderBriefing(data) {
  const briefing = data.briefing;
  elements.headline.textContent = briefing.headline;
  elements.executiveSummary.textContent = briefing.executiveSummary;
  elements.coverageCommits.textContent = data.coverage.commitsAnalyzed;
  elements.coverageRepos.textContent = data.coverage.repositories;
  elements.periodLabel.textContent = `${data.coverage.days} días · ${elements.repositorySelector.selectedOptions[0].textContent}`;
  elements.generatedAt.textContent = new Date(data.generatedAt).toLocaleString("es-ES");
  elements.cacheState.textContent = data.cached ? "resultado en caché" : "análisis recién generado";
  elements.attentionBadge.className = `badge ${briefing.overallAttention}`;
  elements.attentionBadge.textContent = ({ normal: "Sin intervención inmediata", watch: "Requiere seguimiento", action: "Requiere acción" })[briefing.overallAttention];
  elements.decisionCount.textContent = briefing.decisions.length;
  elements.riskCount.textContent = briefing.risks.length;
  renderItems(elements.decisions, briefing.decisions, "decision");
  renderItems(elements.risks, briefing.risks, "risk");
  renderItems(elements.achievements, briefing.achievements, "finding");
  renderItems(elements.watchItems, briefing.watchItems, "finding");
  elements.limitations.innerHTML = briefing.limitations.length
    ? briefing.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>No se declararon limitaciones adicionales.</li>";
}

function renderItems(container, items, kind) {
  if (!items.length) {
    container.innerHTML = '<p class="no-items">La evidencia disponible no sustenta elementos en esta sección.</p>';
    return;
  }
  container.innerHTML = items.map((item) => {
    const title = kind === "decision" ? item.question : item.title;
    const summary = kind === "decision" ? item.context : item.summary;
    const action = kind === "decision" ? item.recommendation : kind === "risk" ? item.recommendedAction : item.businessImpact;
    const label = kind === "decision" ? "Recomendación" : kind === "risk" ? "Acción recomendada" : "Impacto";
    const tone = kind === "decision" ? item.urgency : kind === "risk" ? item.severity : "";
    return `<article class="brief-item ${escapeHtml(tone)}">
      <div class="item-title"><h4>${escapeHtml(title)}</h4>${tone ? `<span class="tag">${escapeHtml(translateTone(tone))}</span>` : ""}</div>
      <p>${escapeHtml(summary)}</p><p class="action"><strong>${label}:</strong> ${escapeHtml(action)}</p>
      <div class="confidence">Confianza: ${Math.round(item.confidence * 100)}%</div>
      <details><summary>Ver evidencia (${item.evidence.length})</summary>${item.evidence.map((evidence) =>
        `<div class="evidence"><code>${escapeHtml(evidence.repositoryKey)} · ${escapeHtml(evidence.commitHash.slice(0, 8))}</code><span>${escapeHtml(evidence.reason)}</span></div>`).join("")}</details>
    </article>`;
  }).join("");
}

function translateTone(value) {
  return ({ monitor: "Monitorizar", soon: "Próxima revisión", now: "Ahora", low: "Bajo", medium: "Medio", high: "Alto" })[value] || value;
}

function setState(active) {
  for (const id of ["loading", "error", "empty", "content"]) elements[id].hidden = id !== active;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

elements.periodSelector.addEventListener("change", () => refreshDashboard(false));
elements.repositorySelector.addEventListener("change", () => refreshDashboard(false));
elements.refreshButton.addEventListener("click", () => refreshDashboard(true));
loadRepositories().then(() => refreshDashboard(false)).catch((error) => { elements.error.textContent = error.message; setState("error"); });
