import axios from "axios";

// Backend origin, e.g. "https://hr.example.com". Used for building absolute URLs to uploaded files.
export const API_BASE = process.env.REACT_APP_BACKEND_URL || "";

// Shared axios instance: all JSON API calls go through `${REACT_APP_BACKEND_URL}/api` with cookies.
// (Exposed to components via useAuth().api and passed down as the `api` prop.)
export const api = axios.create({
  baseURL: `${API_BASE}/api`,
  withCredentials: true,
});

// Resolve a stored avatar/image path to a full URL (absolute URLs are returned untouched).
export const getAvatarUrl = (url) => {
  if (!url || url === "") return null;
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url}`;
};

// Save a binary response body as a file via a temporary <a download> link.
export const saveBlobAsFile = (data, filename) => {
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};
