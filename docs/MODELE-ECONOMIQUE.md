# Modèle économique

Ce document décrit comment le jeu chiffre un réseau. Les paramètres vivent
dans `packages/engine/src/costs.ts` ; ce document et le code évoluent
ensemble.

## Principes

- **Unité** : millions d'euros (M€) hors taxes, aux conditions économiques
  de 2026. Les montants au-delà du milliard s'affichent en Md€.
- **Ordres de grandeur** : les valeurs reprennent les fourchettes publiées
  pour les projets ferroviaires français récents (lignes à grande vitesse,
  modernisations, pôles d'échanges), telles que les rapportent notamment la
  Cour des comptes et le Conseil d'orientation des infrastructures. Elles
  servent à comparer des variantes de tracé, pas à établir un devis.
- **Déterminisme** : le calcul est une fonction pure du réseau et du profil
  en long. Deux joueurs qui dessinent la même ligne obtiennent le même coût.

## Investissement

### Voie et plateforme

Prix au kilomètre d'une double voie, hors ouvrages d'art, terrassements,
électrification et signalisation, selon la vitesse de conception :

| Vitesse  | M€/km |
| -------- | ----- |
| 100 km/h | 4     |
| 160 km/h | 6     |
| 220 km/h | 10    |
| 320 km/h | 16    |

Interpolation linéaire entre les points ; en dessous de 100 km/h le prix
reste à 4 M€/km, au-delà de 320 km/h la dernière pente se prolonge. Une
vitesse plus élevée exige des rayons plus grands, une plateforme plus large
et une voie plus soignée.

Facteurs multiplicatifs :

| Nombre de voies | Facteur |
| --------------- | ------- |
| Voie unique     | 0,6     |
| Double voie     | 1       |
| Quadruple voie  | 1,9     |

La voie métrique coûte 75 % de la voie normale (voie, plateforme et
ouvrages). Le facteur du nombre de voies s'applique à tous les postes
linéaires : terrassements, ouvrages, électrification et signalisation.

### Terrassements

0,12 M€ par kilomètre et par mètre d'écart moyen entre la voie et le
terrain, hors ouvrages. L'écart est tiré du profil en long (ligne rouge
contre terrain) : 10 m de déblai ou de remblai moyen ajoutent 1,2 M€/km. Au
delà de 15 m, le moteur propose un ouvrage (ADR-022).

### Ouvrages d'art

Prix au kilomètre d'ouvrage, double voie, voie portée comprise : la voie
courante n'est pas comptée sous un ouvrage.

| Ouvrage | M€/km |
| ------- | ----- |
| Tunnel  | 45    |
| Viaduc  | 25    |
| Pont    | 20    |

### Équipements

| Électrification  | M€/km | Commentaire                            |
| ---------------- | ----- | -------------------------------------- |
| Aucune           | 0     | traction thermique                     |
| 25 kV alternatif | 1     | sous-stations espacées d'environ 50 km |
| 1,5 kV continu   | 1,4   | sous-stations tous les 10 à 15 km      |

| Signalisation | M€/km | Usage                                  |
| ------------- | ----- | -------------------------------------- |
| BAPR          | 0,25  | lignes peu circulées                   |
| BAL           | 0,6   | lignes chargées                        |
| ERTMS niv. 2  | 0,9   | signalisation en cabine, débit maximal |

### Gares et bifurcations

| Gare                   | Base (M€) | Par quai (M€) |
| ---------------------- | --------- | ------------- |
| Halte                  | 1,5       | 0             |
| Gare                   | 6         | 1,5           |
| Pôle de correspondance | 20        | 3             |
| Gare TGV               | 40        | 5             |

Reprendre une gare existante (code UIC) coûte 40 % du neuf : on la
modernise et on l'agrandit au lieu de la construire.

Une bifurcation à niveau coûte 4 M€ ; un saut-de-mouton, qui supprime les
cisaillements, ajoute 20 M€.

### Études et aléas

Une provision de 15 % s'ajoute à la somme des travaux : études, maîtrise
d'œuvre, acquisitions foncières courantes et aléas de chantier.

### Ordres de grandeur obtenus

- LGV de 100 km en terrain moyen (5 m d'écart moyen, ERTMS, 25 kV) :
  environ 2,1 Md€, soit 21 M€/km hors grands ouvrages.
- Ligne classique à 160 km/h, double voie, BAL et 25 kV, en plaine :
  environ 8,7 M€/km.
- Un tunnel de 4 km sur une ligne à 160 km/h, équipements compris : environ
  215 M€.

## Entretien

Chaque poste coûte chaque année une part de son investissement :

| Poste           | Taux annuel |
| --------------- | ----------- |
| Voie            | 1,2 %       |
| Terrassements   | 0,4 %       |
| Ouvrages d'art  | 0,5 %       |
| Électrification | 2 %         |
| Signalisation   | 3 %         |
| Gares           | 1,5 %       |
| Bifurcations    | 2 %         |

Une ligne nouvelle coûte ainsi de l'ordre de 1 à 1,5 % de son
investissement par an.

## Exploitation des lignes

- **Parc** : nombre de rames pour tenir la cadence, d'après un aller-retour
  (marche type, marge de 5 %, arrêts) et 10 minutes de battement à chaque
  terminus. Son prix est celui du catalogue (de 4,5 M€ pour un autorail à
  32 M€ pour une rame à grande vitesse à deux niveaux).
- **Exploitation** : coût par train-kilomètre du matériel (conduite,
  énergie, entretien des rames, péages forfaitaires), de 9 à 22 €, multiplié
  par les départs quotidiens des deux sens, la longueur de la ligne et
  365 jours.

## Demande et recettes

Le modèle de demande (`packages/engine/src/demand.ts`) tourne dans un
worker du navigateur à chaque modification du réseau.

1. **Rabattement** : chaque commune rejoint la gare desservie la plus
   proche à moins de 20 km. Temps d'accès : 5 min plus le trajet à
   25 km/h.
2. **Marché** : entre deux gares, le nombre de déplacements quotidiens tous
   modes vaut K · Pᵢ · Pⱼ / d², avec Pᵢ et Pⱼ les populations rabattues, d
   la distance à vol d'oiseau (au moins 10 km) et K = 3,5 × 10⁻⁴, calé
   pour qu'une LGV Paris – Lyon transporte de l'ordre de 25 000 voyageurs
   par jour entre les deux villes.
3. **Partage modal** : logit binaire sur les coûts généralisés (minutes).
   - Train : accès et diffusion, attente (moitié de l'intervalle, au plus
     30 min), trajet, 10 min par correspondance, prix du billet converti au
     taux de 25 €/h, et une constante de 30 min (contrainte d'horaire).
   - Voiture : route 1,3 fois plus longue que le vol d'oiseau, 55, 80 ou
     100 km/h selon la distance, 10 min de stationnement, 0,20 €/km
     partagés entre 1,6 occupants.
   - Part du train : 1 / (1 + exp(4 · (Ctrain − Cvoiture) / Cvoiture)).
4. **Affectation** : les voyageurs du train suivent le chemin de coût
   généralisé minimal sur les lignes, correspondances comprises.

Recette moyenne par voyageur-kilomètre : 0,11 € en grande vitesse,
0,09 € en intercités, 0,08 € en régional, 0,07 € en périurbain.

Limites : pas de demande induite (le marché tous modes ne dépend pas de
l'offre), pas de concurrence de l'avion ni du réseau ferré existant, et pas
de pointe horaire : le remplissage se mesure sur la journée.

## Bilan carbone

Les émissions évitées comptent le report de la voiture vers le train :
voyageurs-kilomètres annuels de chaque ligne multipliés par l'écart entre
les facteurs d'émission (kg CO₂e par voyageur-km, ordres de grandeur de la
Base Empreinte de l'ADEME) :

| Mode                   | kg CO₂e / voy.-km |
| ---------------------- | ----------------- |
| Voiture (1,6 occupant) | 0,13              |
| Train électrique       | 0,005             |
| Train bimode           | 0,04              |
| Train thermique        | 0,08              |

La construction des infrastructures n'est pas encore comptée.

## Tableau de bord

Le tableau de bord (touche B) réunit : longueur de voies, gares,
investissement (hors ouvrages d'art), entretien annuel ; lignes, rames,
prix du parc, exploitation annuelle ; voyages quotidiens, voyageurs-km,
recettes, solde d'exploitation (recettes moins exploitation et entretien) et
CO₂ évité. Il affiche aussi la matrice des temps de trajet entre les dix
gares au plus grand bassin et une carte de chaleur des montées.

## Dans l'interface

- L'inspecteur affiche le coût d'une gare, d'une bifurcation, et celui d'un
  tronçon hors ouvrages d'art (sans profil en long, le moteur ne les connaît
  pas encore).
- Le profil en long ajoute le coût complet du tronçon sélectionné : voie,
  terrassements, tunnels et viaducs proposés, équipements et provision.

## Limites connues

- Pas de surcoût urbain ni foncier différencié : traverser une agglomération
  coûte aujourd'hui le prix d'une plaine.
- Les ponts ne sont pas encore détectés automatiquement au franchissement
  des cours d'eau ; seuls tunnels et viaducs sont proposés.
- En montagne, la ligne rouge enchaîne des ouvrages courts plutôt qu'un
  tunnel de base (ADR-022) ; le coût reflète ce tracé, pas l'optimum.
- Les recettes viennent avec le modèle de demande (phase 3).
