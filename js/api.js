// api.js — tynd wrapper omkring backend-kaldene

const Api = {
  async checkAccess() {
    const res = await fetch("/api/checkaccess");
    return res.json();
  },

  async listFiles() {
    const res = await fetch("/api/listfiles");
    if (!res.ok) throw new Error((await res.json()).error || "Fejl ved hentning af filer");
    return (await res.json()).files;
  },

  async getVarer(fileId) {
    const res = await fetch(`/api/getvarer/${encodeURIComponent(fileId)}`);
    if (!res.ok) throw new Error((await res.json()).error || "Fejl ved hentning af varer");
    return (await res.json()).varer;
  },

  async updateVare(fileId, payload) {
    const res = await fetch(`/api/updatevare/${encodeURIComponent(fileId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error((await res.json()).error || "Fejl ved opdatering");
    return res.json();
  },

  async addVare(fileId, payload) {
    const res = await fetch(`/api/addvare/${encodeURIComponent(fileId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error((await res.json()).error || "Fejl ved oprettelse");
    return res.json();
  }
};
