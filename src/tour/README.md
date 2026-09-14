# Visite guidée (Guided Tour)

Module d'onboarding pour les nouveaux utilisateurs de Sker, basé sur
[`react-joyride`](https://docs.react-joyride.com/).

## Contenu

| Fichier | Rôle |
| --- | --- |
| `tourSteps.js` | Liste des étapes (titre, contenu, sélecteur cible). |
| `useGuidedTour.js` | Hook qui gère l'état (run, step) et la persistance localStorage. |
| `GuidedTour.js` | Composant React qui monte le Joyride. |
| `RestartTourButton.js` | Bouton utilitaire pour rejouer la visite. |
| `index.js` | Exports publics du module. |

## Intégration

```jsx
import { GuidedTour } from './tour';

<GuidedTour enabled={isLoggedIn} />
```

La visite se déclenche **automatiquement** la première fois qu'un utilisateur
authentifié charge l'application, puis l'état est mémorisé dans
`localStorage` (clé `sker_app_tour_v1`).

## Marquer un élément cible

Sur n'importe quel composant, ajoutez simplement un attribut `data-tour` :

```jsx
<button data-tour="new-btn">Nouveau</button>
<aside data-tour="sidebar">...</aside>
```

Puis référencez-le dans `tourSteps.js` :

```js
{ target: '[data-tour="new-btn"]', title: '...', content: '...' }
```

## Rejouer / piloter la visite

Depuis n'importe où dans l'app :

```js
window.__skerStartTour();  // relance la visite depuis le début
window.__skerStopTour();   // ferme la visite en cours
```

Ou utilisez directement le composant `<RestartTourButton />`.

## Versioning des étapes

Lorsque l'UI change de manière significative et que vous voulez forcer la
re-lecture pour tous les utilisateurs existants, incrémentez le suffixe de
`TOUR_STORAGE_KEY` dans `useGuidedTour.js` (`sker_app_tour_v1` →
`sker_app_tour_v2`).
