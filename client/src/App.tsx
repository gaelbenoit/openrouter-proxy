import React, { useEffect, useState } from 'react';
import './App.css';

interface KeyInfo {
  label: string;
  description: string;
  isActive: boolean;
  failureCount: number;
  dayCount: number;
  cooldownUntil: string | null;
  lastUsed: string;
  lastFailure: string | null;
}

interface KeyInfoWithLatest extends KeyInfo {
  isLatest: boolean;
}

const KeyCard: React.FC<{ info: KeyInfoWithLatest }> = ({ info }) => {
  const getBarColor = () => {
    if (!info.isActive) return '#bbb';
    if (info.cooldownUntil) return '#4a90e2';
    
    const ratio = Math.min(info.dayCount / 50, 1);
    if (ratio < 0.5) {
      const r = Math.round(128 + 127 * (ratio * 2));
      const g = 255;
      return `rgb(${r},${g},0)`;
    } else {
      const r = 255;
      const g = Math.round(255 * (2 - ratio * 2));
      return `rgb(${r},${g},0)`;
    }
  };

  const formatDate = (iso: string | null): string => {
    if (!iso) return '―';
    const d = new Date(iso);
    return d.toLocaleString();
  };

  return (
    <div className={`key-card ${info.isLatest ? 'key-card-latest' : ''}`}>
      <h3>{info.label}</h3>
      <p><strong>Description:</strong> {info.description || '―'}</p>
      <p><strong>Actif:</strong> {info.isActive ? 'Oui' : 'Non'}</p>

      <div className="key-stats">
        <div className="stat-item">
          <span className="stat-label">Utilisation aujourd'hui:</span>
          <span className="stat-value">{info.dayCount}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Échecs aujourd'hui:</span>
          <span className="stat-value">{info.failureCount}</span>
        </div>
      </div>

      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{
            width: `${(info.dayCount / 50) * 100}%`,
            backgroundColor: getBarColor()
          }}
        />
      </div>

      <div className="key-details">
        <p><strong>Cooldown jusqu'à:</strong> {formatDate(info.cooldownUntil)}</p>
        <p><strong>Dernière utilisation:</strong> {formatDate(info.lastUsed)}</p>
        <p><strong>Dernier échec:</strong> {formatDate(info.lastFailure)}</p>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchKeys = async () => {
      try {
        const response = await fetch('/stats');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data: KeyInfo[] = await response.json();

        // Trouver l'index de la dernière clé utilisée
        const latestKeyIndex = data.reduce((maxIndex, info, currentIndex) => {
          const currentTime = new Date(info.lastUsed).getTime();
          const maxTime = new Date((data[maxIndex] && data[maxIndex].lastUsed) || '').getTime();
          return currentTime > maxTime ? currentIndex : maxIndex;
        }, 0);

        setKeys(data.map((info, index) => ({ ...info, isLatest: index === latestKeyIndex }) as KeyInfoWithLatest));
        setError(null); // Clear any previous error
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      }
    };

    // Fetch immediately, then every 5 seconds
    fetchKeys();
    const interval = setInterval(fetchKeys, 5000);
    return () => clearInterval(interval);
  }, []); // Empty deps array means this runs once on mount

  const handleReset = async () => {
    try {
      const response = await fetch('/dashboard/reset', {
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Le rafraîchissement se fera automatiquement via l'effet useEffect
      alert('Compteurs quotidiens réinitialisés avec succès');
    } catch (err) {
      alert(`Erreur lors de la réinitialisation: ${err instanceof Error ? err.message : 'Erreur inconnue'}`);
    }
  };

  if (error) return <div className="container error">Erreur: {error}</div>;

  return (
    <div className="container">
      <header>
        <h1>Dashboard – Utilisation des clés API</h1>
        <button 
          onClick={handleReset}
          className="reset-button"
        >
          Réinitialiser les compteurs quotidiens
        </button>
      </header>
      <main>
        {keys.map((key, index) => (
          <KeyCard
            key={index}
            info={key as KeyInfoWithLatest}
          />
        ))}
      </main>
    </div>
  );
};

export default App;
