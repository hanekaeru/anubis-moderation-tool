-- Libelles par defaut des boutons de quarantaine : accents retablis.
--
-- Les lignes qui portent encore l'ancien defaut mot pour mot sont corrigees
-- aussi : personne n'a choisi « reglement » sans accent, c'est le defaut qui
-- l'imposait. Un libelle modifie depuis le dashboard n'est pas touche. Le
-- message deja poste sur Discord ne change qu'en rejouant /quarantaine-message.

ALTER TABLE "quarantine_config"
  ALTER COLUMN "button_label" SET DEFAULT 'J''accepte le règlement',
  ALTER COLUMN "battlenet_button_label" SET DEFAULT 'Vérifier mon compte Battle.net';

UPDATE "quarantine_config"
  SET "button_label" = 'J''accepte le règlement'
  WHERE "button_label" = 'J''accepte le reglement';

UPDATE "quarantine_config"
  SET "battlenet_button_label" = 'Vérifier mon compte Battle.net'
  WHERE "battlenet_button_label" = 'Verifier mon compte Battle.net';
