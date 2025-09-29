// client/src/api.js
import axios from "axios";

const API = axios.create({
  baseURL: "/api", // proxy về server
});

// nếu có token thì set luôn
API.interceptors.request.use((config) => {
  const token = localStorage.getItem("adminToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ==== ADMIN API ==== //
export const loginAdmin = (phone, key) =>
  API.post("/login", { phone, key });

export const createKey = (phone, type) =>
  API.post("/create-key", { phone, type });

// ==== USER API ==== //
export const loginUser = (phone, key) =>
  API.post("/login", { phone, key });

export const getHistory = () => API.get("/history");
export const getCoins = () => API.get("/coins");

export default API;
