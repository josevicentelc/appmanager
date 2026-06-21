const state = {
  repositories: [],
  employeeAuthors: [],
  pending: false
};

const repositorySelect = document.querySelector("#repository");
const statusText = document.querySelector("#status");
const messages = document.querySelector("#messages");
const form = document.querySelector("#chatForm");
const questionInput = document.querySelector("#question");
const sendButton = document.querySelector("#sendButton");
const includeContext = document.querySelector("#includeContext");
const audienceInputs = [...document.querySelectorAll('input[name="audience"]')];

// Tab Navigation
function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll(".tab-content").forEach(tab => {
    tab.classList.remove("active");
  });
  
  // Remove active state from all nav tabs
  document.querySelectorAll(".nav-tab").forEach(navTab => {
    navTab.classList.remove("active");
  });
  
  // Show selected tab
  const selectedTab = document.getElementById(`${tabName}-tab`);
  if (selectedTab) {
    selectedTab.classList.add("active");
  }
  
  // Mark nav tab as active
  const navTab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
  if (navTab) {
    navTab.classList.add("active");
  }
  
  // Focus question input when switching to chat tab
  if (tabName === "chat") {
    setTimeout(() => questionInput?.focus(), 0);
  }
}

// Report Generation Functions
async function generateWeeklyReport(button) {
  await generateExecutiveReport(7, button);
}

async function generateMonthlyReport(button) {
  await generateExecutiveReport(30, button);
}

async function loadEmployeeAuthors() {
  const select = document.querySelector("#employeeReportAuthor");
  if (!select) return;
  const data = await fetchJson("/api/employee-reports/authors");
  state.employeeAuthors = data.authors || [];
  select.innerHTML = `<option value="">Todos los empleados</option>${state.employeeAuthors.map((author) =>
    `<option value="${escapeHtml(author.authorName)}">${escapeHtml(author.authorName)}</option>`).join("")}`;
}

async function generateEmployeeReport(button) {
  const from = document.querySelector("#employeeReportFrom")?.value;
  const to = document.querySelector("#employeeReportTo")?.value;
  const authorName = document.querySelector("#employeeReportAuthor")?.value || "";
  const language = document.querySelector("#reportLanguage")?.value === "en" ? "en" : "es";
  if (!from || !to) {
    alert("Selecciona las fechas inicial y final.");
    return;
  }
  const startedAt = Date.now();
  button.disabled = true;
  button.classList.add("generating");
  button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span data-label>Generando informes · 0 s</span>`;
  const timer = setInterval(() => {
    const label = button.querySelector("[data-label]");
    if (label) label.textContent = `Generando informes · ${Math.floor((Date.now() - startedAt) / 1000)} s`;
  }, 1000);
  try {
    const data = await fetchJson("/api/employee-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, authorNames: authorName ? [authorName] : null, language })
    });
    showEmployeeReportModal(data, language);
  } catch (error) {
    alert(`No se pudo generar el informe: ${error.message}`);
  } finally {
    clearInterval(timer);
    button.disabled = false;
    button.classList.remove("generating");
    button.textContent = "Generar informe conjunto";
  }
}

function showEmployeeReportModal(data, language) {
  const title = language === "en" ? "Employee work report" : "Informe de trabajo por empleado";
  const modal = document.createElement("div");
  modal.className = "report-modal";
  const documentNode = document.createElement("div");
  documentNode.className = "report-document";
  documentNode.innerHTML = `
    <header class="report-document-header"><div><span>Engineering Memory</span><h2>${title}</h2></div><button type="button" data-close>Cerrar</button></header>
    <section class="report-summary"><h3>${escapeHtml(data.period.from)} - ${escapeHtml(data.period.to)}</h3><p>${data.reports.length} ${data.reports.length === 1 ? "empleado" : "empleados"} con evidencia analizada.</p></section>
    ${data.reports.length ? data.reports.map(renderEmployeeReport).join("") : '<p class="report-empty">No hay tareas digeridas para la selección.</p>'}
    ${data.emptyAuthors?.length ? `<section class="report-section report-limitations"><h3>Sin evidencia en el periodo</h3><p>${escapeHtml(data.emptyAuthors.join(", "))}</p></section>` : ""}
    ${data.failedAuthors?.length ? `<section class="report-section report-limitations"><h3>Informes no generados</h3>${data.failedAuthors.map((item) => `<p><strong>${escapeHtml(item.authorName)}:</strong> ${escapeHtml(item.error)}</p>`).join("")}</section>` : ""}
    <p class="report-generated">Generado ${escapeHtml(new Date(data.generatedAt).toLocaleString(language === "en" ? "en-GB" : "es-ES"))}. La autoría corresponde a author_name de Git y no mide productividad.</p>
    <footer class="report-actions"><button type="button" data-download>Descargar texto</button><button type="button" data-print>Imprimir / PDF</button></footer>`;
  modal.appendChild(documentNode);
  document.body.appendChild(modal);
  documentNode.querySelector("[data-close]").addEventListener("click", () => modal.remove());
  documentNode.querySelector("[data-download]").addEventListener("click", () => downloadReport(title, formatEmployeeReportAsText(data)));
  documentNode.querySelector("[data-print]").addEventListener("click", () => window.print());
  modal.addEventListener("click", (event) => { if (event.target === modal) modal.remove(); });
}

function renderEmployeeReport(item) {
  const report = item.report;
  return `<section class="employee-report">
    <h3>${escapeHtml(item.authorName)}</h3>
    <div class="report-coverage">${item.evidenceCommits} ${item.evidenceCommits === 1 ? "cambio" : "cambios"} con conocimiento analizado${item.evidenceTruncated ? " · evidencia limitada a los 100 más recientes" : ""}</div>
    <p>${escapeHtml(report.summary)}</p>
    ${report.repositories.map((repository) => `<section class="employee-repository"><h4>${escapeHtml(employeeRepositoryLabel(repository.repositoryKey))}</h4><p>${escapeHtml(repository.summary)}</p><div class="employee-focus-areas">${repository.focusAreas.map((area) => `<span>${escapeHtml(area)}</span>`).join("")}</div>${repository.tasks.map((task) => `<article class="report-item"><h5>${escapeHtml(task.title)}</h5><p>${escapeHtml(task.description)}</p><p><strong>Resultado:</strong> ${escapeHtml(task.outcome)}</p><details><summary>Evidencia y confianza (${Math.round(task.confidence * 100)}%)</summary>${task.evidence.map((evidence) => `<div class="report-evidence"><code>${escapeHtml(evidence.repositoryKey)} · ${escapeHtml(evidence.commitHash.slice(0, 8))}</code><span>${escapeHtml(evidence.reason)}</span></div>`).join("")}</details></article>`).join("")}</section>`).join("")}
    ${report.limitations.length ? `<details class="report-limitations"><summary>Limitaciones</summary><ul>${report.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("")}</ul></details>` : ""}
  </section>`;
}

function employeeRepositoryLabel(repositoryKey) {
  const repository = state.repositories.find((candidate) => candidate.id === repositoryKey);
  return repository ? `${repository.displayName} (${repositoryKey})` : repositoryKey;
}

function formatEmployeeReportAsText(data) {
  return [
    "INFORME DE TRABAJO POR EMPLEADO",
    `Periodo: ${data.period.from} - ${data.period.to}`,
    ...data.reports.map((item) => [
      item.authorName.toUpperCase(),
      item.report.summary,
      ...item.report.repositories.map((repository) => [`PROYECTO/REPOSITORIO: ${repository.repositoryKey}`, repository.summary, `Áreas: ${repository.focusAreas.join(", ")}`, ...repository.tasks.map((task) => `- ${task.title}\n  ${task.description}\n  Resultado: ${task.outcome}\n  Evidencia: ${task.evidence.map((entry) => `${entry.repositoryKey}/${entry.commitHash.slice(0, 8)}`).join(", ")}`)].join("\n\n")),
      ...item.report.limitations.map((limitation) => `Limitación: ${limitation}`)
    ].join("\n\n"))
  ].join("\n\n");
}

async function generateExecutiveReport(days, button) {
  const language = document.querySelector("#reportLanguage")?.value === "en" ? "en" : "es";
  const labels = reportLabels(language);
  const startedAt = Date.now();
  button.disabled = true;
  button.classList.add("generating");
  button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span data-label>${labels.generating} · 0 s</span>`;
  const timer = setInterval(() => {
    const label = button.querySelector("[data-label]");
    if (label) label.textContent = `${labels.generating} · ${Math.floor((Date.now() - startedAt) / 1000)} s`;
  }, 1000);
  try {
    const data = await fetchJson(`/api/executive/briefing?days=${days}&language=${language}`);
    showHumanReportModal(days === 7 ? labels.weeklyTitle : labels.monthlyTitle, data, language);
  } catch (error) {
    alert(`${labels.error}: ${error.message}`);
  } finally {
    clearInterval(timer);
    button.disabled = false;
    button.classList.remove("generating");
    button.textContent = labels.generate;
  }
}

async function showVelocityReport() {
  try {
    const data = await fetchJson("/api/metrics/velocity?days=30");
    showReportModal("Velocidad de Desarrollo (30 días)", data);
  } catch (error) {
    alert("Error al cargar el reporte: " + error.message);
  }
}

async function showStabilityReport() {
  try {
    const data = await fetchJson("/api/metrics/stability");
    showReportModal("Análisis de Estabilidad", data);
  } catch (error) {
    alert("Error al cargar el reporte: " + error.message);
  }
}

function showReportModal(title, data) {
  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  `;
  
  const content = document.createElement("div");
  content.style.cssText = `
    background: white;
    border-radius: 8px;
    max-width: 800px;
    max-height: 80vh;
    overflow: auto;
    padding: 20px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `;
  
  content.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h2 style="margin: 0;">${escapeHtml(title)}</h2>
      <button style="min-height: auto; padding: 6px 12px; font-size: 14px;" onclick="this.closest('div').parentElement.parentElement.remove()">✕ Cerrar</button>
    </div>
    <pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px;">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
    <button style="width: 100%; margin-top: 12px;" onclick="downloadReport('${escapeHtml(title)}', this.parentElement.querySelector('pre').textContent)">📥 Descargar</button>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

function downloadReport(title, content) {
  const element = document.createElement("a");
  element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(content));
  element.setAttribute("download", `${title}-${new Date().toISOString().split('T')[0]}.txt`);
  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

function showHumanReportModal(title, data, language) {
  const labels = reportLabels(language);
  const modal = document.createElement("div");
  modal.className = "report-modal";
  const documentNode = document.createElement("div");
  documentNode.className = "report-document";
  documentNode.innerHTML = `
    <header class="report-document-header">
      <div><span>Engineering Memory</span><h2>${escapeHtml(title)}</h2></div>
      <button type="button" data-close>${labels.close}</button>
    </header>
    ${data.briefing ? renderHumanReport(data.briefing, data, language) : `<p class="report-empty">${labels.insufficient}</p>`}
    <footer class="report-actions"><button type="button" data-download>${labels.download}</button><button type="button" data-print>${labels.print}</button></footer>`;
  modal.appendChild(documentNode);
  document.body.appendChild(modal);
  documentNode.querySelector("[data-close]").addEventListener("click", () => modal.remove());
  documentNode.querySelector("[data-download]").addEventListener("click", () => downloadReport(title, formatReportAsText(title, data, language)));
  documentNode.querySelector("[data-print]").addEventListener("click", () => window.print());
  modal.addEventListener("click", (event) => { if (event.target === modal) modal.remove(); });
}

function renderHumanReport(briefing, data, language) {
  const labels = reportLabels(language);
  const attention = labels.attention[briefing.overallAttention] || briefing.overallAttention;
  return `
    <section class="report-summary"><span class="report-attention ${escapeHtml(briefing.overallAttention)}">${escapeHtml(attention)}</span><h3>${escapeHtml(briefing.headline)}</h3><p>${escapeHtml(briefing.executiveSummary)}</p><div class="report-coverage">${data.coverage.days} ${labels.days} · ${data.coverage.commitsAnalyzed} ${labels.changes} · ${data.coverage.repositories} ${labels.repositories}</div></section>
    ${renderReportSection(labels.decisions, briefing.decisions, "decision", language)}
    ${renderReportSection(labels.risks, briefing.risks, "risk", language)}
    ${renderReportSection(labels.achievements, briefing.achievements, "finding", language)}
    ${renderReportSection(labels.watchItems, briefing.watchItems, "finding", language)}
    <section class="report-section report-limitations"><h3>${labels.limitations}</h3>${briefing.limitations.length ? `<ul>${briefing.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${labels.noLimitations}</p>`}</section>
    <p class="report-generated">${labels.generated} ${escapeHtml(new Date(data.generatedAt).toLocaleString(language === "en" ? "en-GB" : "es-ES"))}. ${labels.gitDisclaimer}</p>`;
}

function renderReportSection(title, items, kind, language) {
  const labels = reportLabels(language);
  const body = items.length ? items.map((item) => {
    const heading = kind === "decision" ? item.question : item.title;
    const description = kind === "decision" ? item.context : item.summary;
    const conclusion = kind === "decision" ? item.recommendation : kind === "risk" ? item.recommendedAction : item.businessImpact;
    const label = kind === "decision" ? labels.recommendation : kind === "risk" ? labels.recommendedAction : labels.impact;
    return `<article class="report-item"><h4>${escapeHtml(heading)}</h4><p>${escapeHtml(description)}</p><p><strong>${label}:</strong> ${escapeHtml(conclusion)}</p><details><summary>${labels.evidenceAndConfidence} (${Math.round(item.confidence * 100)}%)</summary>${item.evidence.map((evidence) => `<div class="report-evidence"><code>${escapeHtml(evidence.repositoryKey)} · ${escapeHtml(evidence.commitHash.slice(0, 8))}</code><span>${escapeHtml(evidence.reason)}</span></div>`).join("")}</details></article>`;
  }).join("") : `<p class="report-empty">${labels.noEvidence}</p>`;
  return `<section class="report-section"><h3>${escapeHtml(title)}</h3>${body}</section>`;
}

function formatReportAsText(title, data, language) {
  const labels = reportLabels(language);
  if (!data.briefing) return `${title}\n\n${labels.insufficient}`;
  const briefing = data.briefing;
  return [title.toUpperCase(), briefing.headline, briefing.executiveSummary, `${labels.period}: ${data.coverage.days} ${labels.days} | ${labels.changes}: ${data.coverage.commitsAnalyzed} | ${labels.repositories}: ${data.coverage.repositories}`, formatTextSection(labels.decisions.toUpperCase(), briefing.decisions, "decision", language), formatTextSection(labels.risks.toUpperCase(), briefing.risks, "risk", language), formatTextSection(labels.achievements.toUpperCase(), briefing.achievements, "finding", language), formatTextSection(labels.watchItems.toUpperCase(), briefing.watchItems, "finding", language), labels.limitations.toUpperCase(), ...briefing.limitations.map((item) => `- ${item}`), `${labels.generated}: ${new Date(data.generatedAt).toLocaleString(language === "en" ? "en-GB" : "es-ES")}`].join("\n\n");
}

function formatTextSection(title, items, kind, language) {
  const labels = reportLabels(language);
  if (!items.length) return `${title}\n${labels.noEvidence}`;
  return `${title}\n${items.map((item) => {
    const heading = kind === "decision" ? item.question : item.title;
    const description = kind === "decision" ? item.context : item.summary;
    const conclusion = kind === "decision" ? item.recommendation : kind === "risk" ? item.recommendedAction : item.businessImpact;
    const evidence = item.evidence.map((entry) => `${entry.repositoryKey}/${entry.commitHash.slice(0, 8)}`).join(", ");
    return `- ${heading}\n  ${description}\n  ${labels.actionOrImpact}: ${conclusion}\n  ${labels.confidence}: ${Math.round(item.confidence * 100)}% | ${labels.evidence}: ${evidence}`;
  }).join("\n")}`;
}

function reportLabels(language) {
  return language === "en" ? {
    generate: "Generate", generating: "Generating report", weeklyTitle: "Weekly report", monthlyTitle: "Monthly report", error: "Could not generate report",
    close: "Close", download: "Download text", print: "Print / PDF", insufficient: "There is not enough information to produce the report.",
    attention: { normal: "No immediate intervention", watch: "Requires monitoring", action: "Action required" },
    days: "days", changes: "changes analysed", repositories: "repositories with evidence", decisions: "Decisions", risks: "Risks", achievements: "Achievements", watchItems: "Items to monitor",
    limitations: "Scope and limitations", noLimitations: "No additional limitations were reported.", generated: "Generated on", gitDisclaimer: "Conclusions are based exclusively on knowledge extracted from Git.",
    recommendation: "Recommendation", recommendedAction: "Recommended action", impact: "Impact", evidenceAndConfidence: "Evidence and confidence", noEvidence: "Available evidence does not support any items in this section.",
    period: "Period", actionOrImpact: "Action/impact", confidence: "Confidence", evidence: "Evidence"
  } : {
    generate: "Generar", generating: "Generando informe", weeklyTitle: "Informe semanal", monthlyTitle: "Informe mensual", error: "No se pudo generar el informe",
    close: "Cerrar", download: "Descargar texto", print: "Imprimir / PDF", insufficient: "No hay información suficiente para elaborar el informe.",
    attention: { normal: "Sin intervención inmediata", watch: "Requiere seguimiento", action: "Requiere acción" },
    days: "días", changes: "cambios analizados", repositories: "repositorios con evidencia", decisions: "Decisiones", risks: "Riesgos", achievements: "Logros", watchItems: "Señales a vigilar",
    limitations: "Alcance y limitaciones", noLimitations: "No se declararon limitaciones adicionales.", generated: "Generado el", gitDisclaimer: "Las conclusiones se basan exclusivamente en conocimiento extraído de Git.",
    recommendation: "Recomendación", recommendedAction: "Acción recomendada", impact: "Impacto", evidenceAndConfidence: "Evidencia y confianza", noEvidence: "La evidencia disponible no sustenta elementos en esta sección.",
    period: "Periodo", actionOrImpact: "Acción/impacto", confidence: "Confianza", evidence: "Evidencia"
  };
}

async function boot() {
  const [health, repositories] = await Promise.all([
    fetchJson("/api/health"),
    fetchJson("/api/repositories"),
    loadEmployeeAuthors()
  ]);

  state.repositories = repositories.repositories;
  repositorySelect.innerHTML = state.repositories.map((repository) => (
    `<option value="${escapeHtml(repository.id)}">${escapeHtml(repository.displayName)} · ${escapeHtml(repository.branch)}</option>`
  )).join("");

  const digest = health.digestDaemon?.enabled
    ? health.digestDaemon.running ? "digest activo" : "digest esperando"
    : "digest inactivo";
  statusText.textContent = `${health.model} · ${digest}`;

  const today = new Date();
  const from = new Date(today.getTime() - 29 * 86_400_000);
  document.querySelector("#employeeReportTo").value = today.toISOString().slice(0, 10);
  document.querySelector("#employeeReportFrom").value = from.toISOString().slice(0, 10);
}

questionInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  form.requestSubmit();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question || state.pending) {
    return;
  }

  appendMessage("user", "Pregunta", question);
  questionInput.value = "";
  setPending(true);
  const audience = getAudience();
  const pendingMessage = appendPendingMessage();

  try {
    const result = await fetchChatStream({
      question,
      repositoryKey: repositorySelect.value,
      limit: 5,
      audience,
      includeContext: audience === "developer" && includeContext.checked
    }, (message) => pendingMessage.setStage(message));

    pendingMessage.remove();
    appendAssistantMessage(result);
  } catch (error) {
    pendingMessage.remove();
    appendMessage("assistant", "Error", error instanceof Error ? error.message : String(error));
  } finally {
    setPending(false);
    questionInput.focus();
  }
});

function appendAssistantMessage(result) {
  const node = document.createElement("article");
  node.className = "message assistant";

  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  node.innerHTML = [
    "<h2>Respuesta</h2>",
    `<pre>${escapeHtml(result.answer || "")}</pre>`,
    renderCandidates(candidates, result.audience || "developer"),
    result.context ? `<details><summary>Contexto recuperado</summary><pre>${escapeHtml(result.context)}</pre></details>` : ""
  ].join("");

  messages.appendChild(node);
  scrollMessagesToBottom();
}

function renderCandidates(candidates, audience) {
  if (candidates.length === 0) {
    return "";
  }

  const items = candidates.slice(0, 10).map((candidate) => audience === "user"
    ? `<div class="candidate">
        <strong>Cambio relacionado</strong>
        <div>${escapeHtml(candidate.summary)}</div>
      </div>`
    : `<div class="candidate">
        <strong>${escapeHtml(candidate.repositoryKey)}</strong>
        <code>${escapeHtml(candidate.shortHash)}</code>
        ${candidate.versionTags?.length ? `<code>${escapeHtml(candidate.versionTags.join(", "))}</code>` : ""}
        ${escapeHtml(candidate.subject)}
        <div>Autor Git: ${escapeHtml(candidate.authorName)}</div>
        <div>${escapeHtml(candidate.summary)}</div>
      </div>`
  ).join("");

  return `<div class="candidates">${items}</div>`;
}

function getAudience() {
  return audienceInputs.find((input) => input.checked)?.value || "developer";
}

function updateAudienceControls() {
  const isDeveloper = getAudience() === "developer";
  includeContext.disabled = !isDeveloper;
  if (!isDeveloper) {
    includeContext.checked = false;
  }
  includeContext.closest(".context-toggle")?.classList.toggle("disabled", !isDeveloper);
}

audienceInputs.forEach((input) => input.addEventListener("change", updateAudienceControls));
updateAudienceControls();

function appendMessage(kind, title, content) {
  const node = document.createElement("article");
  node.className = `message ${kind}`;
  node.innerHTML = `<h2>${escapeHtml(title)}</h2><pre>${escapeHtml(content)}</pre>`;
  messages.appendChild(node);
  scrollMessagesToBottom();
}

function appendPendingMessage() {
  const node = document.createElement("article");
  node.className = "message assistant pending-message";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.innerHTML = `
    <h2>Procesando consulta</h2>
    <div class="pending-status">
      <span class="spinner" aria-hidden="true"></span>
      <span data-stage>Iniciando búsqueda</span>
      <span class="pending-time" data-elapsed>0 s</span>
    </div>`;
  messages.appendChild(node);
  scrollMessagesToBottom();

  const startedAt = Date.now();
  const timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const elapsedNode = node.querySelector("[data-elapsed]");
    if (elapsedNode) {
      elapsedNode.textContent = `${elapsed} s`;
    }
  }, 1000);

  return {
    setStage(message) {
      const stageNode = node.querySelector("[data-stage]");
      if (stageNode) {
        stageNode.textContent = message;
      }
      scrollMessagesToBottom();
    },
    remove() {
      clearInterval(timer);
      node.remove();
    }
  };
}

function scrollMessagesToBottom() {
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

function setPending(pending) {
  state.pending = pending;
  sendButton.disabled = pending;
  sendButton.textContent = pending ? "Pensando" : "Preguntar";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function fetchChatStream(payload, onStatus) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) {
        continue;
      }
      const event = JSON.parse(dataLine.slice(6));
      if (event.type === "status") {
        onStatus(event.message);
      } else if (event.type === "result") {
        result = event.data;
      } else if (event.type === "error") {
        throw new Error(event.message || "Error procesando la consulta");
      }
    }

    if (done) {
      break;
    }
  }

  if (!result) {
    throw new Error("El servidor no devolvió una respuesta completa");
  }
  return result;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

boot().catch((error) => {
  statusText.textContent = error instanceof Error ? error.message : String(error);
});
