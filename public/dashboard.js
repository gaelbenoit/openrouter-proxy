// Fonction utilitaire pour convertir une chaîne ISO en date locale lisible
function fmtDate(iso) {
  if (!iso) return '―';
  const d = new Date(iso);
  return d.toLocaleString();
}

// Détermine la couleur de la barre en fonction du statut
function getBarColor(info) {
  if (!info.isActive) return '#bbb';               // gris – inactif
  if (info.cooldownUntil) return '#4a90e2';        // bleu – en cooldown
  // Dégradation du vert → jaune → rouge en fonction de dayCount / 50
  const ratio = Math.min(info.dayCount / 50, 1);   // 0 → 1
  if (ratio < 0.5) {
    // vert → jaune
    const r = Math.round(128 + 127 * (ratio * 2)); // 128 à 255 (vert à jaune)
    const g = 255;
    return 'rgb(' + r + ',' + g + ',0)';
  } else {
    // jaune → rouge
    const r = 255;
    const g = Math.round(255 * (2 - ratio * 2));  // 255 à 0
    return 'rgb(' + r + ',' + g + ',0)';
  }
}

// Met à jour le tableau avec les données reçues
async function refresh() {
  try {
    const resp = await fetch('/stats');
    const data = await resp.json();
    const container = document.getElementById('keys');
    container.innerHTML = ''; // nettoyer

    // Trouver l'index de la dernière clé utilisée
    let latestKeyIndex = 0;
    let latestTime = 0;
    data.forEach((info, index) => {
      const usedTime = new Date(info.lastUsed).getTime();
      if (usedTime > latestTime) {
        latestTime = usedTime;
        latestKeyIndex = index;
      }
    });

    data.forEach((info, index) => {
      const div = document.createElement('div');
      div.className = 'key-bar';

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = info.label;
      div.appendChild(label);

      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = (info.dayCount / 50) * 100 + '%';
      fill.style.background = getBarColor(info);

      bar.appendChild(fill);

      const tooltip = document.createElement('div');
      tooltip.className = 'tooltip';
      tooltip.innerHTML = '<strong>Clé :</strong>' + info.label + '<br><strong>Description :</strong>' + (info.description || '―') + '<br><strong>Actif :</strong>' + (info.isActive ? 'Oui' : 'Non') + '<br><strong>Utilisation aujourd\'hui :</strong>' + info.dayCount + '<br><strong>Échecs aujourd\'hui :</strong>' + info.failureCount + '<br><strong>Cooldown jusqu\'à :</strong>' + fmtDate(info.cooldownUntil) + '<br><strong>Dernière utilisation :</strong>' + fmtDate(info.lastUsed) + '<br><strong>Dernier échec :</strong>' + fmtDate(info.lastFailure);

      bar.appendChild(tooltip);

      div.appendChild(bar);

      // Mettre en évidence la dernière clé utilisée
      if (index === latestKeyIndex) {
        div.classList.add('active-key');
      }

      container.appendChild(div);
    });
  } catch (e) {
    console.error('Erreur lors du rafraîchissement du dashboard :', e);
  }
}

// Rafraîchissement initial puis toutes les 5 secondes
refresh();
setInterval(refresh, 5000);