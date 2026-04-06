import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export const API_BASE = '/api';

/** Options so session cookie is sent and received (required for session-scoped init). */
const WITH_CREDENTIALS = { withCredentials: true };

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  get<T>(path: string, params?: Record<string, string>): Observable<T> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => { httpParams = httpParams.set(k, v); });
    }
    return this.http.get<T>(`${API_BASE}${path}`, { params: httpParams, ...WITH_CREDENTIALS });
  }

  postForm(
    path: string,
    body: Record<string, string | number | boolean>,
    opts?: { signal?: AbortSignal },
  ): Observable<unknown> {
    const form = new FormData();
    Object.entries(body).forEach(([k, v]) => form.append(k, String(v)));
    return this.http.post(`${API_BASE}${path}`, form, {
      ...WITH_CREDENTIALS,
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });
  }

  postFormWithFiles(path: string, body: Record<string, unknown>, files?: File[]): Observable<unknown> {
    const form = new FormData();
    Object.entries(body).forEach(([k, v]) => {
      if (v !== undefined && v !== null && typeof v !== 'object') form.append(k, String(v));
    });
    files?.forEach((file) => form.append('files', file, file.name));
    return this.http.post(`${API_BASE}${path}`, form, WITH_CREDENTIALS);
  }

  postFile(path: string, file: File, extra?: Record<string, string>): Observable<unknown> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (extra) Object.entries(extra).forEach(([k, v]) => form.append(k, v));
    return this.http.post(`${API_BASE}${path}`, form, WITH_CREDENTIALS);
  }

  getBlob(path: string, params?: Record<string, string>): Observable<Blob> {
    let httpParams = new HttpParams();
    if (params) Object.entries(params).forEach(([k, v]) => { httpParams = httpParams.set(k, v); });
    return this.http.get(`${API_BASE}${path}`, { params: httpParams, responseType: 'blob', ...WITH_CREDENTIALS });
  }

  postJson<T>(path: string, body: object): Observable<T> {
    return this.http.post<T>(`${API_BASE}${path}`, body, WITH_CREDENTIALS);
  }

  postJsonBlob(path: string, body: object): Observable<Blob> {
    return this.http.post(`${API_BASE}${path}`, body, { responseType: 'blob', ...WITH_CREDENTIALS });
  }

  delete(path: string): Observable<unknown> {
    return this.http.delete(`${API_BASE}${path}`, WITH_CREDENTIALS);
  }
}
