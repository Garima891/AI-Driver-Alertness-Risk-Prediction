document.addEventListener('DOMContentLoaded', () => {

    const ids = [
        'overspeeding_severity', 'drunk_driving_severity', 'traffic_violation_severity',
        'mobile_use_severity', 'wrong_side_driving_severity', 'sudden_braking_severity',
        'driver_drowsy_score'
    ];
    const selectIds = ['road_type', 'time_of_day', 'weather_condition'];
    const labelMap = {
        'overspeeding_severity': 'val_overspeeding',
        'drunk_driving_severity': 'val_drunk',
        'traffic_violation_severity': 'val_violation',
        'mobile_use_severity': 'val_mobile',
        'wrong_side_driving_severity': 'val_wronglane',
        'sudden_braking_severity': 'val_braking',
        'driver_drowsy_score': 'val_drowsy'
    };

    let audioMuted = false;
    let audioPlayedForCurrentHighRisk = false;

    // Mute button logic
    const muteBtn = document.getElementById('muteBtn');
    muteBtn.addEventListener('click', () => {
        audioMuted = !audioMuted;
        muteBtn.textContent = audioMuted ? '🔕' : '🔔';
    });

    // Update labels on slider move & shift colors smoothly
    ids.forEach(id => {
        const slider = document.getElementById(id);
        const labelId = labelMap[id];
        const label = document.getElementById(labelId);
        if(label) {
            slider.addEventListener('input', (e) => {
                label.textContent = parseFloat(e.target.value).toFixed(2);
                const val = parseFloat(e.target.value);
                // Shift thumb color from green to red based on value
                const r = val < 0.5 ? 74 + (val*2)*(250-74) : 250 + ((val-0.5)*2)*(248-250);
                const g = val < 0.5 ? 222 + (val*2)*(204-222) : 204 + ((val-0.5)*2)*(113-204);
                const b = val < 0.5 ? 128 + (val*2)*(21-128)  :  21 + ((val-0.5)*2)*(113-21);
                slider.style.setProperty('--thumb-color', `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`);
            });
        }
    });

    const predictBtn = document.getElementById('predictBtn');
    const resetBtn = document.getElementById('resetBtn');
    const loader = document.getElementById('loader');
    const btnText = document.querySelector('.btn-text');

    function playBeep() {
        if (audioMuted) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        
        try {
            const ctx = new AudioContext();
            
            // Beep 1
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.15);
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
            gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
            osc.connect(gainNode);
            gainNode.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
            
            // Beep 2
            const osc2 = ctx.createOscillator();
            const gainNode2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(660, ctx.currentTime + 0.2);
            osc2.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.35);
            gainNode2.gain.setValueAtTime(0, ctx.currentTime + 0.2);
            gainNode2.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.25);
            gainNode2.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
            osc2.connect(gainNode2);
            gainNode2.connect(ctx.destination);
            osc2.start(ctx.currentTime + 0.2);
            osc2.stop(ctx.currentTime + 0.35);
            
        } catch(e) {
            console.error("Audio API error", e);
        }
    }

    resetBtn.addEventListener('click', () => {
        ids.forEach(id => {
            const el = document.getElementById(id);
            el.value = 0.0;
            const labelId = labelMap[id];
            const label = document.getElementById(labelId);
            if(label) label.textContent = "0.00";
        });
        selectIds.forEach(id => document.getElementById(id).selectedIndex = 0);
        
        document.getElementById('outputWidget').className = 'card output-widget';
        document.getElementById('riskScoreVal').textContent = "0.00";
        document.getElementById('riskPercentVal').textContent = "0%";
        document.getElementById('riskRing').style.background = `conic-gradient(var(--border-color) 0deg, transparent 0)`;
        document.getElementById('riskLevelText').textContent = "AWAITING PREDICTION...";
        document.getElementById('riskExplanation').textContent = "Waiting for sensor data input.";
        
        // Reset integrated alerts panel
        const intAlerts = document.getElementById('integratedAlerts');
        if (intAlerts) intAlerts.innerHTML = '<div class="alert-placeholder">No alerts yet. Run analysis to see results.</div>';

        // Hide analysis link until next prediction
        const analysisLink = document.getElementById('analysisLink');
        if (analysisLink) analysisLink.style.display = 'none';

        // Clear session snapshot
        sessionStorage.removeItem('driverSnapshot');
        
        audioPlayedForCurrentHighRisk = false;
    });

    predictBtn.addEventListener('click', async () => {
        const payload = {};
        ids.forEach(id => payload[id] = parseFloat(document.getElementById(id).value));
        selectIds.forEach(id => payload[id] = document.getElementById(id).value);

        btnText.style.display = 'none';
        loader.style.display = 'inline-block';
        predictBtn.disabled = true;

        // Simulated Spinner delay for smoother UI feel 1.2s
        await new Promise(r => setTimeout(r, 1200));

        try {
            const response = await fetch('/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();

            if(response.ok) {
                updateUI(data);
            } else {
                alert('Error making prediction: ' + data.error);
            }
        } catch (err) {
            console.error(err);
            alert('Failed to connect to the prediction server.');
        } finally {
            btnText.style.display = 'inline';
            loader.style.display = 'none';
            predictBtn.disabled = false;
        }
    });

    function getGradientColor(score) {
        if (score <= 0.4) return '#4ade80';
        if (score <= 0.7) return '#facc15';
        return '#f87171';
    }

    function animateValue(obj, start, end, duration, formatFloat = false) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const val = progress * (end - start) + start;
            if(formatFloat) obj.innerHTML = val.toFixed(2);
            else obj.innerHTML = Math.floor(val) + "%";
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    function updateUI(data) {
        const widget = document.getElementById('outputWidget');
        const scoreVal = document.getElementById('riskScoreVal');
        const percentVal = document.getElementById('riskPercentVal');
        const ring = document.getElementById('riskRing');
        const levelText = document.getElementById('riskLevelText');
        const expText = document.getElementById('riskExplanation');

        widget.className = 'card output-widget';
        
        const currentScoreText = scoreVal.textContent;
        const startScore = isNaN(parseFloat(currentScoreText)) ? 0 : parseFloat(currentScoreText);
        animateValue(scoreVal, startScore, data.risk_score, 400, true);
        animateValue(percentVal, startScore*100, data.risk_score*100, 400, false);

        levelText.textContent = data.risk_level + " RISK";
        expText.textContent = data.explanation;

        // Animate ring gradient visually
        const degrees = Math.round(data.risk_score * 360);
        const ringColor = getGradientColor(data.risk_score);
        ring.style.background = `conic-gradient(${ringColor} ${degrees}deg, var(--border-color) 0)`;

        // Classes for text coloring
        const level = data.risk_level;
        if(level === 'HIGH') {
            widget.classList.add('theme-high');
        } else if (level === 'MEDIUM') {
            widget.classList.add('theme-medium');
        } else {
            widget.classList.add('theme-safe');
        }

        // Render integrated alerts below the gauge
        const integratedAlerts = document.getElementById('integratedAlerts');
        integratedAlerts.innerHTML = '';

        let alerts = data.alerts || [];

        // Check if there's any high alert to trigger sound
        const hasHigh = alerts.some(a => a.level === 'high');
        if(hasHigh && !audioPlayedForCurrentHighRisk) {
            setTimeout(playBeep, 500);
            audioPlayedForCurrentHighRisk = true;
        } else if (!hasHigh) {
            audioPlayedForCurrentHighRisk = false;
        }

        // Sort: High first
        alerts.sort((a,b) => {
            if (a.level === 'high' && b.level !== 'high') return -1;
            if (a.level !== 'high' && b.level === 'high') return 1;
            return 0;
        });

        if (alerts.length === 0) {
            integratedAlerts.innerHTML = '<div class="alert-placeholder">✅ No alerts — driving conditions are safe.</div>';
        }

        alerts.forEach((alertObj, idx) => {
            const msg = alertObj.message;
            let iconText = alertObj.level === 'high' ? '🚨' : '⚠️';

            if (msg.includes("speed"))  iconText = '🚗';
            else if (msg.includes("lane"))      iconText = '↔️';
            else if (msg.includes("mobile"))    iconText = '📱';
            else if (msg.includes("drowsy") || msg.includes("tired") || msg.includes("break")) iconText = '😴';
            else if (msg.includes("influence") || msg.includes("drunk") || msg.includes("Impairment")) iconText = '🍺';
            else if (msg.includes("traffic") || msg.includes("rules")) iconText = '🚦';
            else if (msg.includes("braking") || msg.includes("Brake")) iconText = '🛑';

            const item = document.createElement('div');
            item.className = `alert-item ${alertObj.level}`;
            item.style.animationDelay = `${idx * 0.07}s`;

            const spanIcon = document.createElement('span');
            spanIcon.className = 'alert-icon';
            spanIcon.textContent = iconText;

            const spanText = document.createElement('span');
            spanText.textContent = msg;

            item.appendChild(spanIcon);
            item.appendChild(spanText);
            integratedAlerts.appendChild(item);
        });

        // Show the "View Analysis" link after first prediction
        const analysisLink = document.getElementById('analysisLink');
        if (analysisLink) analysisLink.style.display = 'inline-flex';

        // Store current values in sessionStorage for the analysis page
        const inputSnapshot = {};
        ['overspeeding_severity','drunk_driving_severity','traffic_violation_severity',
         'mobile_use_severity','wrong_side_driving_severity','sudden_braking_severity','driver_drowsy_score'].forEach(id => {
            inputSnapshot[id] = parseFloat(document.getElementById(id).value);
        });
        inputSnapshot['risk_score'] = data.risk_score;
        inputSnapshot['risk_level'] = data.risk_level;
        sessionStorage.setItem('driverSnapshot', JSON.stringify(inputSnapshot));
    }

});
