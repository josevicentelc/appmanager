import fs from 'node:fs/promises';
import https from 'node:https';

const ASANA_BASE = 'https://app.asana.com/api/1.0';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function safeAttachmentName(value) {
  const name = String(value ?? 'attachment').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\.+$/g, '');
  return name.slice(0, 160) || 'attachment';
}

export class AsanaClient {
  constructor({ token, workspaceId, caCertFile = null, timeoutMs = 30_000, maxRetries = 3, maxAttachmentBytes = 25 * 1024 * 1024 }) {
    this.token = token; this.workspaceId = workspaceId; this.caCertFile = caCertFile; this.timeoutMs = timeoutMs; this.maxRetries = maxRetries; this.maxAttachmentBytes = maxAttachmentBytes; this.agent = null;
  }
  configured() { return Boolean(this.token && this.workspaceId); }
  headers() { return { Authorization: `Bearer ${this.token}` }; }
  async getAgent() {
    if (this.agent || !this.caCertFile) return this.agent;
    this.agent = new https.Agent({ ca: await fs.readFile(this.caCertFile) });
    return this.agent;
  }
  async fetch(url, headers = this.headers()) {
    const target = url instanceof URL ? url : new URL(url);
    const agent = await this.getAgent();
    return new Promise((resolve, reject) => {
      const request = https.get(target, { headers, agent, timeout: this.timeoutMs }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, data: Buffer.concat(chunks) }));
      });
      request.on('timeout', () => request.destroy(new Error('Asana request timed out.')));
      request.on('error', reject);
    });
  }
  async request(path, params = {}) {
    const url = new URL(`${ASANA_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetch(url);
        if (response.status >= 200 && response.status < 300) return JSON.parse(response.data.toString('utf8'));
        const body = response.data.toString('utf8');
        if ((response.status === 429 || response.status >= 500) && attempt < this.maxRetries) {
          const retryAfter = Number(response.headers['retry-after']);
          await sleep(Number.isFinite(retryAfter) ? retryAfter * 1_000 : 1_000 * 2 ** attempt);
          continue;
        }
        throw new Error(`Asana ${response.status} ${url.pathname}: ${body.slice(0, 1_000)}`);
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries && (error.name === 'TimeoutError' || error.cause?.code === 'ECONNRESET' || error.cause?.code === 'ETIMEDOUT' || error.cause?.code === 'EAI_AGAIN')) {
          await sleep(1_000 * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }
  async list(path, params = {}) {
    const entries = [];
    let offset;
    do {
      const body = await this.request(path, { ...params, limit: 100, offset });
      entries.push(...(body.data ?? []));
      offset = body.next_page?.offset;
    } while (offset);
    return entries;
  }
  async listProjects() {
    return this.list(`/workspaces/${this.workspaceId}/projects`, { opt_fields: 'gid,name,permalink_url,archived,created_at,modified_at' });
  }
  async listProjectTasks(projectGid) {
    return this.list(`/projects/${projectGid}/tasks`, { completed_since: '1970-01-01T00:00:00.000Z', opt_fields: 'gid,name,modified_at,completed,completed_at,permalink_url' });
  }
  async getTask(taskGid) {
    const body = await this.request(`/tasks/${taskGid}`, {
      opt_fields: 'gid,name,notes,html_notes,permalink_url,created_at,modified_at,completed,completed_at,completed_by.name,assignee.gid,assignee.name,assignee_status,due_on,due_at,start_on,start_at,resource_subtype,projects.gid,projects.name,memberships.project.gid,memberships.project.name,memberships.section.gid,memberships.section.name,tags.gid,tags.name,custom_fields.gid,custom_fields.name,custom_fields.display_value,custom_fields.text_value,custom_fields.number_value,custom_fields.enum_value.name,followers.gid,followers.name,parent.gid,parent.name,dependencies.gid,dependents.gid'
    });
    return body.data;
  }
  async getStories(taskGid) {
    return this.list(`/tasks/${taskGid}/stories`, {
      opt_fields: 'gid,type,resource_subtype,text,html_text,created_at,created_by.gid,created_by.name,assignee.gid,assignee.name,project.gid,project.name,section.gid,section.name,tag.gid,tag.name,new_dates,old_dates,new_name,old_name,new_value,old_value'
    });
  }
  async getAttachments(taskGid) {
    return this.list(`/tasks/${taskGid}/attachments`, { opt_fields: 'gid,name,created_at,download_url,view_url,host,resource_subtype,parent.gid,parent.name' });
  }
  async downloadAttachment(attachment) {
    if (!attachment.download_url) return { downloaded: false, reason: 'Asana did not provide a download URL.', name: safeAttachmentName(attachment.name) };
    const url = new URL(attachment.download_url);
    if (url.protocol !== 'https:') throw new Error('Attachment download URL must use HTTPS.');
    const response = await this.fetch(url);
    if (response.status < 200 || response.status >= 300) throw new Error(`Attachment ${attachment.gid} download failed with ${response.status}.`);
    const declaredSize = Number(response.headers['content-length']);
    if (Number.isFinite(declaredSize) && declaredSize > this.maxAttachmentBytes) return { downloaded: false, reason: `Attachment exceeds ${this.maxAttachmentBytes} bytes.`, name: safeAttachmentName(attachment.name), size: declaredSize };
    const data = response.data;
    if (data.length > this.maxAttachmentBytes) return { downloaded: false, reason: `Attachment exceeds ${this.maxAttachmentBytes} bytes.`, name: safeAttachmentName(attachment.name), size: data.length };
    return { downloaded: true, name: safeAttachmentName(attachment.name), data, size: data.length, contentType: response.headers['content-type'] ?? null };
  }
}
