import axios from "axios";

export const API_URL = import.meta.env?.VITE_BACKEND_API_URL || "http://localhost:3000/api";
export const http = axios.create({ withCredentials: true });
let requests = new AbortController();
export function cancelUserRequests() {
  requests.abort();
  requests = new AbortController();
}
http.interceptors.request.use((request) => {
  request.signal = requests.signal;
  return request;
});
http.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401) window.dispatchEvent(new Event("infraforge:session-ended"));
  return Promise.reject(error);
});
