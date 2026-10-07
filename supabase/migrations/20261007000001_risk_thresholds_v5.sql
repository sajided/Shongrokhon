-- Generator v5 retrain (model p2-01b6a9ed): the calibrated operating points moved.
-- The column defaults in 20261002000006_risk.sql were updated for fresh databases;
-- this brings an already-migrated app_config row in step. Values come from
-- ml/artifacts/metadata.json (ml/tests/test_thresholds_in_sync.py checks the defaults).
update public.app_config
   set risk_review_threshold = 0.21,
       risk_flag_threshold = 0.58
 where risk_review_threshold = 0.25
   and risk_flag_threshold = 0.5;
