import React, { useState } from "react";
import axios from "axios";

function AdminApp() {
  const [phone, setPhone] = useState("");
  const [key, setKey] = useState("");
  const [token, setToken] = useState(localStorage.getItem("adminToken") || "");
  const [newKey, setNewKey] = useState("");
  const [targetPhone, setTargetPhone] = useState("");
  const [type, setType] = useState("week");

  const login = async () => {
    try {
      const res = await axios.post("/api/login", { phone, key });
      localStorage.setItem("adminToken", res.data.token);
      setToken(res.data.token);
      alert("Đăng nhập thành công!");
    } catch (err) {
      alert("Sai thông tin admin!");
    }
  };

  const createKey = async () => {
    try {
      const res = await axios.post(
        "/api/create-key",
        { phone: targetPhone, type },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setNewKey(res.data.key);
    } catch (err) {
      alert("Tạo key thất bại!");
    }
  };

  if (!token) {
    return (
      <div className="p-5">
        <h2>Admin Login</h2>
        <input
          placeholder="Số điện thoại"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          placeholder="Dynamic Key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button onClick={login}>Đăng nhập</button>
      </div>
    );
  }

  return (
    <div className="p-5">
      <h2>Admin Panel</h2>
      <input
        placeholder="Số điện thoại user"
        value={targetPhone}
        onChange={(e) => setTargetPhone(e.target.value)}
      />
      <select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="week">Week</option>
        <option value="month">Month</option>
      </select>
      <button onClick={createKey}>Tạo Key</button>

      {newKey && (
        <div>
          <h3>Key mới:</h3>
          <code>{newKey}</code>
        </div>
      )}
    </div>
  );
}

export default AdminApp;
