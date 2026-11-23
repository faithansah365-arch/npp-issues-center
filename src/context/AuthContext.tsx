import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PublicUser } from '../../shared/types';
import { apiRequest } from '../lib/api';

interface AuthContextValue {
  user: PublicUser | null;
  unreadNotifications: number;
  retentionDays: number;
  loading: boolean;
  refreshSession: () => Promise<PublicUser | null>;
  setUnreadNotifications: React.Dispatch<React.SetStateAction<number>>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [retentionDays, setRetentionDays] = useState(730);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async (): Promise<PublicUser | null> => {
    try {
      const data = await apiRequest<{
        user: PublicUser;
        unreadNotifications: number;
        retentionDays: number;
      }>('/api/auth/me');
      setUser(data.user);
      setUnreadNotifications(data.unreadNotifications);
      setRetentionDays(data.retentionDays);
      return data.user;
    } catch {
      setUser(null);
      setUnreadNotifications(0);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setUnreadNotifications(0);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        unreadNotifications,
        retentionDays,
        loading,
        refreshSession,
        setUnreadNotifications,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
