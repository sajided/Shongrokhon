# Product Requirements Document (PRD)
**Product Name:** Project Shongrokhon (Unified MFS & AI Financial Coach)
**Platform:** Mobile (React Native / Expo)
**Target Audience:** MFS users in Bangladesh, specifically those with high cash dependency.

## 1. Product Overview
This product is a unified Mobile Financial Services (MFS) application that fundamentally solves two problems. First, it protects the MFS ecosystem by actively detecting and blocking QR code abuse (specifically disguised cash-outs). Second, it uses that exact transaction data to build a user-specific purchase history profile, powering an AI Financial Health Coach that empowers users to make better financial decisions, reduce cash dependency, and build financial independence.

## 2. Problem Statement
*   **The Ecosystem Threat:** Malicious actors abuse the Bangla QR system by setting up pseudo-merchants to facilitate unauthorized cash-outs. This bypasses fee structures and damages the legitimate agent ecosystem.
*   **The Customer Challenge:** Users lack financial literacy and visibility into their spending habits, leading to chronic cash dependency, liquidity pressure, and poor savings habits.

## 3. Core Objectives (The "Two Pillars")
1.  **Platform Defense (Track 01):** Detect MFS abuse via real-time risk scoring, behavioral anomaly detection, and network risk analysis.
2.  **Customer Empowerment (Track 03):** Create a secure purchase history profile to power a Bangla-friendly AI coach that explains spending behavior, simulates cash flow, and creates realistic savings plans.

## 4. Key Features & Requirements

### 4.1 Backend: Trust & Risk Intelligence
*   **Real-time Transaction Risk Scoring:** Use XGBoost/LightGBM to estimate the probability that a QR transaction is a suspicious disguised cash-out.
*   **Behavioral Anomaly Detection:** Implement Isolation Forest/Autoencoders to learn a user's normal transaction baseline and flag uncharacteristic deviations.
*   **Network Risk Intelligence:** Utilize Graph ML to map transaction networks and identify connected risky wallets.
*   **AI Investigation Assistant:** Use SHAP (feature attribution) and LLMs to explain why an alert was generated and summarize evidence for compliance analysts.

### 4.2 Frontend: Customer Innovation & Financial Coach
*   **MFS Core Utility:** Fast, reliable Bangla QR scanner for everyday payments.
*   **AI Financial Health Coach:** A dashboard providing simple, plain-language (Bangla-friendly) explanations of spending behavior and cash dependency.
*   **Smart Spending Companion:** Intercepts high-risk cash-out behaviors before payment execution, suggesting digital alternatives.
*   **Personal Savings Planner:** Allows users to input goals (e.g., "Save ৳30,000 in six months") and generates a realistic monthly contribution plan based on their transaction history.
*   **Cash-Flow Forecasting:** Predicts short-term liquidity pressure to prevent panic cash withdrawals.

## 5. Technical Architecture
*   **Frontend Mobile App:** React Native & Expo (iOS & Android).
*   **Backend Middleware & API:** Next.js deployed on Vercel.
*   **Database & Auth:** Supabase (PostgreSQL) for user profiles, secure ledger, and encrypted transaction histories.
*   **LLM Processing:** Gemini or Groq API for natural language insight generation.
*   **Machine Learning Microservices:** Python-based ML APIs (FastAPI) hosting the XGBoost and Isolation Forest models for ultra-low latency scoring.

---

## 6. Development Phases

### Phase 1: Foundation & Core MFS (Weeks 1-3)
*   Initialize React Native / Expo repository.
*   Set up Supabase authentication and PostgreSQL database schemas (Users, Transactions, Wallets).
*   Develop the core QR scanning module and basic payment flow (Ledger updates).
*   Ensure the app can successfully process a standard, low-risk transaction.

### Phase 2: Risk Intelligence Pipeline (Weeks 4-6)
*   Develop and train the transaction classification model (XGBoost) using historical/mock MFS data.
*   Develop the behavioral anomaly detection model (Isolation Forest).
*   Deploy ML models as low-latency microservices.
*   Integrate the ML pipeline into the transaction flow: scan -> score -> execute/flag.

### Phase 3: The Profile Engine & AI Coach (Weeks 7-9)
*   Build the Next.js API middleware to securely batch and sanitize user transaction histories.
*   Integrate Gemini/Groq APIs with strict system prompts for financial categorization and insight generation.
*   Develop the frontend UI for the AI Financial Health Coach dashboard (React Native).
*   Implement the "Personal Savings Planner" and "Cash-Flow Forecasting" UI components.

### Phase 4: Active Interventions & Polish (Weeks 10-12)
*   Build the interception UI (Smart Spending Companion) that prompts users with digital alternatives when repetitive cash-out behavior is detected.
*   Implement the AI Investigation Assistant dashboard for backend compliance (SHAP explanations).
*   Localize the app interface and LLM prompts for natural, conversational Bangla.
*   End-to-end testing, latency optimization, and bug fixing.

## 7. Success Metrics
*   **Risk Metric:** False positive/negative rate of the XGBoost classification model.
*   **System Metric:** Transaction latency (must process ML score + ledger update in < 1.5 seconds).
*   **User Metric:** Reduction in cash-out frequency among users engaging with the AI Coach.
*   **Engagement Metric:** Daily Active Users (DAU) interacting with the Savings Planner or Financial Insights tabs.