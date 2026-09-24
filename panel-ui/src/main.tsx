import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import "./index.css";
import PrimeiraCarga from "./telas/PrimeiraCarga";
import PaginaMudanca from "./telas/PaginaMudanca";

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/primeira-carga" replace /> },
  { path: "/primeira-carga", element: <PrimeiraCarga /> },
  { path: "/releases/:id", element: <PaginaMudanca /> },
  // rota amigavel: o link do Telegram aponta para /mudancas/:id (sem jargao)
  { path: "/mudancas/:id", element: <PaginaMudanca /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
