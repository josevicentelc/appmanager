const reportContent = {
  executive: {
    title: 'Informe ejecutivo',
    description: 'Configura el período para obtener una visión global de la evolución del proyecto.'
  },
  daily: {
    title: 'Informe diario',
    description: 'Configura el período y, si lo necesitas, filtra la actividad por un usuario concreto.'
  }
};

const isoDate = (date) => date.toISOString().slice(0, 10);

function downloadBlob(file, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function reportResponse(response) {
  if (response.ok) return response.blob();
  const data = await response.json();
  throw new Error(data.error || 'No se pudo generar el informe.');
}

/** Owns report tabs, date defaults, downloads and persistent LLM instructions. */
export function initializeReports({ $, api, getConfig, setConfig }) {
  const today = new Date();
  const currentDay = isoDate(today);
  $('#executiveReportFrom').value = isoDate(new Date(today.getFullYear(), today.getMonth(), 1));
  $('#executiveReportTo').value = isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  $('#dailyReportFrom').value = currentDay;
  $('#dailyReportTo').value = currentDay;

  document.querySelectorAll('[data-report]').forEach((button) => button.addEventListener('click', () => {
    const report = button.dataset.report;
    const details = reportContent[report];
    $('#executiveReportForm').hidden = report !== 'executive';
    $('#dailyReportForm').hidden = report !== 'daily';
    $('#reportTitle').textContent = details.title;
    $('#reportDescription').textContent = details.description;
    document.querySelectorAll('[data-report]').forEach((option) => {
      const active = option === button;
      option.classList.toggle('active', active);
      option.setAttribute('aria-selected', String(active));
    });
  }));

  $('#executiveReportForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const from = $('#executiveReportFrom').value;
    const to = $('#executiveReportTo').value;
    const status = $('#executiveReportStatus');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (!from || !to || from > to) { status.textContent = 'Selecciona un rango de fechas válido.'; status.className = 'report-download-status error'; return; }
    button.disabled = true; status.textContent = 'Preparando el PDF…'; status.className = 'report-download-status';
    try {
      const response = await fetch('/api/reports/executive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }) });
      downloadBlob(await reportResponse(response), `informe-ejecutivo-${from}_a_${to}.pdf`);
      status.textContent = 'Descarga iniciada.'; status.className = 'report-download-status success';
    } catch (error) { status.textContent = error.message; status.className = 'report-download-status error'; }
    finally { button.disabled = false; }
  });

  $('#dailyReportForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const from = $('#dailyReportFrom').value;
    const to = $('#dailyReportTo').value;
    const author = $('#dailyReportUser').value;
    const status = $('#dailyReportStatus');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (!from || !to || from > to) { status.textContent = 'Selecciona un rango de fechas válido.'; status.className = 'report-download-status error'; return; }
    if (!author) { status.textContent = 'Selecciona un usuario.'; status.className = 'report-download-status error'; return; }
    button.disabled = true; status.textContent = 'Generando el informe…'; status.className = 'report-download-status';
    try {
      const response = await fetch('/api/reports/daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, author }) });
      downloadBlob(await reportResponse(response), `informe-diario-${from}_a_${to}.pdf`);
      status.textContent = 'Descarga iniciada.'; status.className = 'report-download-status success';
    } catch (error) { status.textContent = error.message; status.className = 'report-download-status error'; }
    finally { button.disabled = false; }
  });

  $('#saveReportInstructions').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const status = $('#reportInstructionsStatus');
    button.disabled = true; status.textContent = 'Guardando…'; status.className = 'report-instructions-status';
    try {
      const result = await api('/api/report-instructions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instructions: $('#reportInstructions').value }) });
      setConfig({ ...getConfig(), reportInstructions: result.reportInstructions });
      $('#reportInstructions').value = result.reportInstructions;
      status.textContent = 'Instrucciones guardadas.'; status.className = 'report-instructions-status success';
    } catch (error) { status.textContent = error.message; status.className = 'report-instructions-status error'; }
    finally { button.disabled = false; }
  });
}
