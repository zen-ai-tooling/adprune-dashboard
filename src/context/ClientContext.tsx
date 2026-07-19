import React, { createContext, useContext, useState, useEffect } from "react";

export interface Client {
  id: string;
  name: string;
  initials: string;
  acosTarget: number;
  fewerThanOrders: number;
  excludeRanking: boolean;
  createdAt: string;
}

interface ClientContextValue {
  clients: Client[];
  activeClient: Client;
  setActiveClient: (client: Client) => void;
  addClient: (client: Omit<Client, "id" | "createdAt">) => void;
  updateClient: (client: Client) => void;
}

const defaultClient: Client = {
  id: "default",
  name: "My Account",
  initials: "AD",
  acosTarget: 35,
  fewerThanOrders: 5,
  excludeRanking: true,
  createdAt: new Date().toISOString(),
};

const ClientContext = createContext<ClientContextValue | null>(null);

export const ClientProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clients, setClients] = useState<Client[]>(() => {
    try {
      const saved = localStorage.getItem("adprune-settings");
      return saved ? JSON.parse(saved) : [defaultClient];
    } catch {
      return [defaultClient];
    }
  });

  const [activeClient, setActiveClientState] = useState<Client>(() => {
    try {
      const savedId = localStorage.getItem("adprune-active-settings");
      const saved = localStorage.getItem("adprune-settings");
      if (saved && savedId) {
        const parsed = JSON.parse(saved);
        return parsed.find((c: Client) => c.id === savedId) ?? parsed[0] ?? defaultClient;
      }
      const saved2 = localStorage.getItem("adprune-settings");
      if (saved2) {
        const parsed = JSON.parse(saved2);
        return parsed[0] ?? defaultClient;
      }
    } catch {}
    return defaultClient;
  });

  useEffect(() => {
    localStorage.setItem("adprune-settings", JSON.stringify(clients));
  }, [clients]);

  const setActiveClient = (client: Client) => {
    setActiveClientState(client);
    localStorage.setItem("adprune-active-settings", client.id);
  };

  const addClient = (data: Omit<Client, "id" | "createdAt">) => {
    const newClient: Client = {
      ...data,
      id: `client-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setClients((prev) => [...prev, newClient]);
    setActiveClient(newClient);
  };

  const updateClient = (updated: Client) => {
    setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    if (activeClient.id === updated.id) setActiveClientState(updated);
  };

  return (
    <ClientContext.Provider value={{ clients, activeClient, setActiveClient, addClient, updateClient }}>
      {children}
    </ClientContext.Provider>
  );
};

export const useClient = (): ClientContextValue => {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("useClient must be used within ClientProvider");
  return ctx;
};
