import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Shell } from "./components/Shell";
import { useAuth } from "./contexts/Auth";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import AdminDashboard from "./pages/admin/Dashboard";
import Participants from "./pages/admin/Participants";
import Teams from "./pages/admin/Teams";
import Rooms from "./pages/admin/Rooms";
import RoomConfigure from "./pages/admin/RoomConfigure";
import RoomLive from "./pages/RoomLive";
import Results from "./pages/Results";
import MyRooms from "./pages/ParticipantRooms";
import JoinByCode from "./pages/JoinByCode";
import Audit from "./pages/admin/Audit";
import { Spinner } from "./components/Spinner";

function Guard({ children, adminOnly = false }: { children: React.ReactElement; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  // keep where they were going (e.g. an invite link) so sign-in can return there
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (adminOnly && user.role !== "ADMIN") return <Navigate to="/rooms" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/" element={<RootRedirect />} />
      <Route path="/admin" element={<Guard adminOnly><AdminDashboard /></Guard>} />
      <Route path="/admin/participants" element={<Guard adminOnly><Participants /></Guard>} />
      <Route path="/admin/teams" element={<Guard adminOnly><Teams /></Guard>} />
      <Route path="/admin/rooms" element={<Guard adminOnly><Rooms /></Guard>} />
      <Route path="/admin/rooms/:roomId" element={<Guard adminOnly><RoomConfigure /></Guard>} />
      <Route path="/admin/audit" element={<Guard adminOnly><Audit /></Guard>} />
      <Route path="/rooms" element={<Guard><MyRooms /></Guard>} />
      <Route path="/room/:roomId" element={<Guard><RoomLive /></Guard>} />
      <Route path="/join/:code" element={<Guard><JoinByCode /></Guard>} />
      <Route path="/room/:roomId/results" element={<Guard><Results /></Guard>} />
      <Route path="/my-results" element={<Guard><Results self /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "ADMIN" ? "/admin" : "/rooms"} replace />;
}
