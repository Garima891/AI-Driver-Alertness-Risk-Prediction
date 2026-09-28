from flask import Flask, request, jsonify, render_template
import joblib
import pandas as pd

app = Flask(__name__)

# Load the trained pipeline (preprocessor + model)
model = joblib.load('model.pkl')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        
        # Expecting these fields exactly matching dataset features
        features = {
            'overspeeding_severity': float(data.get('overspeeding_severity', 0)),
            'drunk_driving_severity': float(data.get('drunk_driving_severity', 0)),
            'traffic_violation_severity': float(data.get('traffic_violation_severity', 0)),
            'mobile_use_severity': float(data.get('mobile_use_severity', 0)),
            'wrong_side_driving_severity': float(data.get('wrong_side_driving_severity', 0)),
            'sudden_braking_severity': float(data.get('sudden_braking_severity', 0)),
            'driver_drowsy_score': float(data.get('driver_drowsy_score', 0)),
            'road_type': data.get('road_type', 'Urban'),
            'time_of_day': data.get('time_of_day', 'Morning'),
            'weather_condition': data.get('weather_condition', 'Clear')
        }
        
        # Predict using pipeline
        df_input = pd.DataFrame([features])
        prediction = model.predict(df_input)[0]
        
        # Scale the prediction slightly (factor 1.08) because RF models average
        # out extremes, preventing it from naturally hitting 1.0 on its own.
        scaled_prediction = prediction * 1.08
        
        # Cap risk between 0 and 1 theoretically, and round to 2 decimals
        risk_score = round(max(0.0, min(1.0, float(scaled_prediction))), 2)
        risk_percentage = f"{int(risk_score * 100)}%"
        
        # Risk Category
        if risk_score <= 0.4:
            risk_level = "SAFE"
        elif risk_score <= 0.7:
            risk_level = "MEDIUM"
        else:
            risk_level = "HIGH"
            
        # Core Alerts Logic
        alerts = []
        explanation_triggers = []
        
        if risk_score > 0.7:
            alerts.append({"message": "HIGH RISK - STOP VEHICLE IMMEDIATELY", "level": "high"})
        elif risk_score > 0.4:
            alerts.append({"message": "MEDIUM RISK - DRIVE CAREFULLY", "level": "moderate"})
            
        def check_feature(value, feature_name, msg_mod, msg_high):
            if value > 0.6:
                alerts.append({"message": msg_high, "level": "high"})
                if feature_name not in explanation_triggers:
                    explanation_triggers.append(feature_name)
            elif value > 0.3:
                alerts.append({"message": msg_mod, "level": "moderate"})
                if feature_name not in explanation_triggers:
                    explanation_triggers.append(feature_name)
                    
        check_feature(features['overspeeding_severity'], 'overspeeding', 'Reduce speed', 'Reduce speed immediately')
        check_feature(features['wrong_side_driving_severity'], 'wrong side driving', 'Correct your lane', 'Move to correct lane immediately')
        check_feature(features['mobile_use_severity'], 'mobile usage', 'Avoid mobile use', 'Stop using mobile phone immediately')
        check_feature(features['driver_drowsy_score'], 'drowsiness', 'You appear tired', 'Driver is extremely drowsy - take a break')
        check_feature(features['sudden_braking_severity'], 'harsh braking', 'Brake gently', 'Avoid harsh braking')
        check_feature(features['drunk_driving_severity'], 'drunk driving', 'Impairment detected', 'Do not drive under influence')
        check_feature(features['traffic_violation_severity'], 'traffic violations', 'Follow traffic signs', 'Major traffic rules violated')
            
        # Build Explanation
        if not explanation_triggers:
            if risk_score > 0.4:
                explanation = "Risk is elevated due to a combination of minor infractions."
            else:
                explanation = "Risk level is acceptable based on current readings. Safe driving observed."
        else:
            env_factors = []
            if features['weather_condition'] in ['Rain', 'Fog']:
                env_factors.append(features['weather_condition'].lower() + "y")
            if features['time_of_day'] in ['Night']:
                env_factors.append("night")
            
            env_text = ""
            if env_factors:
                env_text = f" in {' and '.join(env_factors)} conditions"
            
            if len(explanation_triggers) == 1:
                explanation = f"Risk elevated significantly due to {explanation_triggers[0]}{env_text}."
            else:
                triggers_formatted = ", ".join(explanation_triggers[:-1]) + ", and " + explanation_triggers[-1]
                explanation = f"Risk elevated significantly due to {triggers_formatted}{env_text}."
            
        response = {
            "risk_score": round(risk_score, 2),
            "risk_percentage": risk_percentage,
            "risk_level": risk_level,
            "alerts": alerts,
            "explanation": explanation
        }
        
        return jsonify(response)

    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/analysis')
def analysis():
    return render_template('analysis.html')

@app.route('/analyze', methods=['POST'])
def analyze():
    """
    Master analysis hub: ensures perfect consistency across the entire Analysis Page.
    Uses the same single prediction logic from Page 1.
    """
    try:
        data = request.json

        NUMERIC_COLS = [
            'overspeeding_severity', 'drunk_driving_severity', 'traffic_violation_severity',
            'mobile_use_severity', 'wrong_side_driving_severity', 'sudden_braking_severity',
            'driver_drowsy_score'
        ]

        FEATURE_LABELS_MAP = {
            'overspeeding_severity': 'overspeeding',
            'drunk_driving_severity': 'drunk driving',
            'traffic_violation_severity': 'traffic violations',
            'mobile_use_severity': 'mobile usage',
            'wrong_side_driving_severity': 'wrong side driving',
            'sudden_braking_severity': 'harsh braking',
            'driver_drowsy_score': 'drowsiness'
        }

        # ── Capture current working state (Snaphot + any simulation override) ──
        state = {col: float(data.get(col, 0)) for col in NUMERIC_COLS}
        state.update({
            'road_type': data.get('road_type', 'Urban'),
            'time_of_day': data.get('time_of_day', 'Morning'),
            'weather_condition': data.get('weather_condition', 'Clear')
        })
        target_feature = data.get('target_feature', 'overspeeding_severity')

        # ── CORE PREDICTION FUNCTION (Single Source of Truth) ──
        def get_risk(f_dict):
            df = pd.DataFrame([f_dict])
            raw_pred = model.predict(df)[0]
            # Use same scaling logic as Page 1
            scaled = raw_pred * 1.08
            return round(max(0.0, min(1.0, float(scaled))), 4)

        # 1. Main Risk Score & Level for the current state
        curr_risk = get_risk(state)
        if   curr_risk <= 0.4: level = 'SAFE'
        elif curr_risk <= 0.7: level = 'MEDIUM'
        else:                  level = 'HIGH'

        # 2. Sensitivity Analysis (Δrisk for each feature +0.1 from CURRENT state)
        sensitivity = {}
        for feat in NUMERIC_COLS:
            mod = state.copy()
            mod[feat] = min(1.0, state[feat] + 0.1)
            new_risk = get_risk(mod)
            sensitivity[feat] = {
                'current_val': round(state[feat], 2),
                'delta_pct': round((new_risk - curr_risk) * 100, 2)
            }

        # 3. Dynamic Top Factor (Marginal Impact: which feature if set to 0 drops risk most)
        impacts = {}
        for feat in NUMERIC_COLS:
            zeroed = state.copy()
            zeroed[feat] = 0.0
            drop = curr_risk - get_risk(zeroed)
            impacts[feat] = max(0.0, drop)
        
        top_factor_key = max(impacts, key=impacts.get)
        
        # 4. Dynamic Explanation Summary
        # Based on features > 0.3 threshold
        triggers = [FEATURE_LABELS_MAP[f] for f in NUMERIC_COLS if state[f] > 0.3]
        env = []
        if state['weather_condition'] in ('Rain', 'Fog'):
            env.append(state['weather_condition'].lower() + "y")
        if state['time_of_day'] == 'Night':
            env.append('night')
        env_text = f" in {' and '.join(env)} conditions" if env else ""

        if not triggers:
            explanation = "Risk level is low. Maintain steady control." if curr_risk < 0.4 else "Risk elevated due to combined environmental factors."
        else:
            if len(triggers) == 1:
                explanation = f"Risk significantly influenced by {triggers[0]}{env_text}."
            else:
                triggers_txt = ", ".join(triggers[:-1]) + ", and " + triggers[-1]
                explanation = f"Primary risks detected: {triggers_txt}{env_text}."

        # 5. Smooth Simulation Curve (21 points)
        curve = []
        for step in range(21):
            x_val = round(step / 20.0, 3)
            sim_state = state.copy()
            sim_state[target_feature] = x_val
            y_val = get_risk(sim_state)
            curve.append({'x': x_val, 'y': y_val})

        # 6. Static Feature Importance (Model Property)
        rf_regressor = model.named_steps['regressor']
        importances = rf_regressor.feature_importances_
        n_numeric = len(NUMERIC_COLS)
        raw_imp = importances[:n_numeric]
        norm_imp = [round(float(i/sum(raw_imp)*100),1) for i in raw_imp]
        importance_map = {NUMERIC_COLS[i]: norm_imp[i] for i in range(n_numeric)}

        return jsonify({
            'risk_score': curr_risk,
            'risk_level': level,
            'explanation': explanation,
            'sensitivity': sensitivity,
            'top_factor': top_factor_key,
            'simulation_curve': curve,
            'feature_importance': importance_map,
            'target_feature': target_feature
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 400




if __name__ == '__main__':
    app.run(debug=True, port=5001)
