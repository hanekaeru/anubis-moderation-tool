# TODO - Anubis

## Channels d'archivage des actions utilisateurs (feature-create-logs-channels)

L'idée serait d'avoir plusieurs salons pour archiver les différentes actions effectuées par les membres. La liste des actions à cataloguer sont les suivantes :
- Messages (#logs-messages)
[] Modification d'un message
Données nécessaires :
Message (Auteur, Date du message, Date de la modification, Contenu avant, Contenu après)
[] Suppression d'un message
Données nécessaires :
Message (Auteur, Date du message, Contenu)
Action (Qui a supprimé ?, Date de la suppression)
- Profils (#logs-profils)
- Membres (#logs-membres)
- Tickets (#logs-tickets)
- Vocaux (#logs-vocaux)
