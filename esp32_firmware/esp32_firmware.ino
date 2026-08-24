#include <WiFi.h>
#include <WiFiManager.h>
#include <Firebase_ESP_Client.h>

#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// --------------------------------------------------------
// PATIENT / DEVICE CONFIGURATION
// --------------------------------------------------------
#define DEVICE_ID "rudrachakraborty589" 

#define API_KEY "AIzaSyByaCu0TOBMDOTyIQ2eH2WVFWl-7whEXIM"
#define DATABASE_URL "https://studio-2428193126-b3db0-default-rtdb.firebaseio.com/"

// --------------------------------------------------------
// HARDWARE PIN MAPPING
// --------------------------------------------------------
#define VALVE_1 23 // Pinky
#define VALVE_2 22 // (no finger)
#define VALVE_3 21 // Ring
#define VALVE_4 19 // Middle
#define VALVE_5 5  // Index
#define VALVE_6 18 // Thumb
#define RPWM 32
#define LPWM 33
#define R_EN 25
#define L_EN 26

// RELAY LOGIC (Active Low)
#define VALVE_ON LOW
#define VALVE_OFF HIGH

// --------------------------------------------------------
// FIREBASE OBJECTS
// --------------------------------------------------------
FirebaseData streamMotor;
FirebaseData streamAngles;
FirebaseData fbdoData; // Used for full JSON reads and heartbeat updates
FirebaseAuth auth;
FirebaseConfig config;

// State Variables - motorControl
bool masterEnabled = false;
bool motorEnabled = false;
int motorControlSpeed = 0;
bool v1_enabled = false;
bool v2_enabled = false;
bool v3_enabled = false;
bool v4_enabled = false;
bool v5_enabled = false;
bool v6_enabled = false;
bool emergencyStop = false;

// State Variables - doctorComputedAngles
float angleThumb = 0.0;
float angleIndex = 0.0;
float angleMiddle = 0.0;
float angleRing = 0.0;
float anglePinky = 0.0;
float angleWrist = 0.0;
int therapyMotorSpeed = 0;
bool therapyActive = false;
bool handTrackingActive = false;
String therapyMode = "";

String anglesPath = String("/doctorComputedAngles/") + DEVICE_ID;
String statusPath = String("/devices/") + DEVICE_ID;

unsigned long sendDataPrevMillis = 0;

void updateHardware() {
  bool controlActive = masterEnabled && motorEnabled;
  if (emergencyStop) {
    controlActive = false;
  }

  // Determine active speed and valve states based on Logic #4
  int activeSpeed = 0;
  bool actV1 = false, actV2 = false, actV3 = false, actV4 = false, actV5 = false, actV6 = false;

  if (!therapyActive) {
    // Normal manual mode
    activeSpeed = motorControlSpeed;
    actV1 = v1_enabled;
    actV2 = v2_enabled;
    actV3 = v3_enabled;
    actV4 = v4_enabled;
    actV5 = v5_enabled;
    actV6 = v6_enabled;
  } else {
    // Therapy Mode is active
    activeSpeed = therapyMotorSpeed;

    bool useFingerAngles = false;
    if (therapyMode == "withRecording") {
      if (handTrackingActive) {
        useFingerAngles = true;
      } else {
        // Fallback to manual while calibrating
        actV1 = v1_enabled;
        actV2 = v2_enabled;
        actV3 = v3_enabled;
        actV4 = v4_enabled;
        actV5 = v5_enabled;
        actV6 = v6_enabled;
      }
    } else if (therapyMode == "withoutRecording") {
      useFingerAngles = true;
    }

    if (useFingerAngles) {
      // Per-finger angle rule
      actV1 = (anglePinky > 50.0);
      actV2 = false; // V2 has no finger -> keep off
      actV3 = (angleRing > 50.0);
      actV4 = (angleMiddle > 50.0);
      actV5 = (angleIndex > 50.0);
      actV6 = (angleThumb > 15.0);
    }
  }

  // Safety Gate: Motor runs only while controlActive AND speed > 0 AND at least one valve is open
  bool anyValveOpen = actV1 || actV2 || actV3 || actV4 || actV5 || actV6;
  
  if (!controlActive) {
    actV1 = actV2 = actV3 = actV4 = actV5 = actV6 = false;
    anyValveOpen = false;
  }

  // Actuate Valves
  digitalWrite(VALVE_1, actV1 ? VALVE_ON : VALVE_OFF);
  digitalWrite(VALVE_2, actV2 ? VALVE_ON : VALVE_OFF);
  digitalWrite(VALVE_3, actV3 ? VALVE_ON : VALVE_OFF);
  digitalWrite(VALVE_4, actV4 ? VALVE_ON : VALVE_OFF);
  digitalWrite(VALVE_5, actV5 ? VALVE_ON : VALVE_OFF);
  digitalWrite(VALVE_6, actV6 ? VALVE_ON : VALVE_OFF);

  // Actuate Motor
  if (controlActive && activeSpeed > 0 && anyValveOpen) {
    analogWrite(RPWM, activeSpeed);
    analogWrite(LPWM, 0);
  } else {
    // DO NOT zero the stored speed value, just stop the PWM.
    analogWrite(RPWM, 0);
    analogWrite(LPWM, 0);
  }
}

void parseMotorData(FirebaseJson *json) {
  FirebaseJsonData jsonData;
  json->get(jsonData, "masterEnabled");
  if (jsonData.success) masterEnabled = jsonData.boolValue;

  json->get(jsonData, "enabled");
  if (jsonData.success) motorEnabled = jsonData.boolValue;

  json->get(jsonData, "speed");
  if (jsonData.success) motorControlSpeed = jsonData.intValue;

  json->get(jsonData, "v1_enabled");
  if (jsonData.success) v1_enabled = jsonData.boolValue;
  
  json->get(jsonData, "v2_enabled");
  if (jsonData.success) v2_enabled = jsonData.boolValue;
  
  json->get(jsonData, "v3_enabled");
  if (jsonData.success) v3_enabled = jsonData.boolValue;
  
  json->get(jsonData, "v4_enabled");
  if (jsonData.success) v4_enabled = jsonData.boolValue;
  
  json->get(jsonData, "v5_enabled");
  if (jsonData.success) v5_enabled = jsonData.boolValue;
  
  json->get(jsonData, "v6_enabled");
  if (jsonData.success) v6_enabled = jsonData.boolValue;

  json->get(jsonData, "emergencyStop");
  if (jsonData.success) emergencyStop = jsonData.boolValue;
}

void parseAnglesData(FirebaseJson *json) {
  FirebaseJsonData jsonData;
  json->get(jsonData, "thumb");
  if (jsonData.success) angleThumb = jsonData.floatValue;
  
  json->get(jsonData, "index");
  if (jsonData.success) angleIndex = jsonData.floatValue;
  
  json->get(jsonData, "middle");
  if (jsonData.success) angleMiddle = jsonData.floatValue;
  
  json->get(jsonData, "ring");
  if (jsonData.success) angleRing = jsonData.floatValue;
  
  json->get(jsonData, "pinky");
  if (jsonData.success) anglePinky = jsonData.floatValue;

  json->get(jsonData, "wrist");
  if (jsonData.success) angleWrist = jsonData.floatValue;

  json->get(jsonData, "motorSpeed");
  if (jsonData.success) therapyMotorSpeed = jsonData.intValue;

  json->get(jsonData, "therapyActive");
  if (jsonData.success) therapyActive = jsonData.boolValue;

  json->get(jsonData, "handTrackingActive");
  if (jsonData.success) handTrackingActive = jsonData.boolValue;

  json->get(jsonData, "mode");
  if (jsonData.success) therapyMode = jsonData.stringValue;
}

void setup() {
  Serial.begin(115200);

  // Set pin modes
  pinMode(VALVE_1, OUTPUT);
  pinMode(VALVE_2, OUTPUT);
  pinMode(VALVE_3, OUTPUT);
  pinMode(VALVE_4, OUTPUT);
  pinMode(VALVE_5, OUTPUT);
  pinMode(VALVE_6, OUTPUT);
  pinMode(RPWM, OUTPUT);
  pinMode(LPWM, OUTPUT);
  pinMode(R_EN, OUTPUT);
  pinMode(L_EN, OUTPUT);

  // Initial State: All valves OFF
  digitalWrite(VALVE_1, VALVE_OFF);
  digitalWrite(VALVE_2, VALVE_OFF);
  digitalWrite(VALVE_3, VALVE_OFF);
  digitalWrite(VALVE_4, VALVE_OFF);
  digitalWrite(VALVE_5, VALVE_OFF);
  digitalWrite(VALVE_6, VALVE_OFF);

  // Enable pins must start HIGH and remain HIGH at all times
  digitalWrite(R_EN, HIGH);
  digitalWrite(L_EN, HIGH);
  analogWrite(RPWM, 0);
  analogWrite(LPWM, 0);

  // Connect WiFi using WiFiManager
  WiFiManager wm;
  bool res = wm.autoConnect("MotionMirror_ESP");
  if(!res) {
    Serial.println("Failed to connect to WiFi");
    ESP.restart();
  } else {
    Serial.println("WiFi connected");
  }

  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;

  // Sign up for anonymous auth if required or use a legacy token.
  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println("Firebase Auth OK");
  } else {
    Serial.printf("Firebase Auth Error: %s\n", config.signer.signupError.message.c_str());
  }

  config.token_status_callback = tokenStatusCallback;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // Begin Multi-Streams
  if (!Firebase.RTDB.beginStream(&streamMotor, "/motorControl")) {
    Serial.printf("Motor stream begin error: %s\n", streamMotor.errorReason().c_str());
  }

  if (!Firebase.RTDB.beginStream(&streamAngles, anglesPath.c_str())) {
    Serial.printf("Angles stream begin error: %s\n", streamAngles.errorReason().c_str());
  }

  // Do an initial full read of both nodes immediately after stream setup
  if (Firebase.RTDB.getJSON(&fbdoData, "/motorControl")) {
    FirebaseJson json = fbdoData.jsonObject();
    parseMotorData(&json);
  }
  if (Firebase.RTDB.getJSON(&fbdoData, anglesPath.c_str())) {
    FirebaseJson json = fbdoData.jsonObject();
    parseAnglesData(&json);
  }
  
  updateHardware();
}

void loop() {
  if (!Firebase.ready()) return;

  // 1. Check and Process motorControl stream
  Firebase.RTDB.readStream(&streamMotor);
  if (streamMotor.streamTimeout()) {
    Serial.println("Motor stream timeout, resuming...");
    Firebase.RTDB.beginStream(&streamMotor, "/motorControl");
  }
  if (streamMotor.streamAvailable()) {
    // When delta arrives, fetch the FULL node to avoid single-field staleness
    if (Firebase.RTDB.getJSON(&fbdoData, "/motorControl")) {
      FirebaseJson json = fbdoData.jsonObject();
      parseMotorData(&json);
      updateHardware();
    }
  }

  // 2. Check and Process doctorComputedAngles stream
  Firebase.RTDB.readStream(&streamAngles);
  if (streamAngles.streamTimeout()) {
    Serial.println("Angles stream timeout, resuming...");
    Firebase.RTDB.beginStream(&streamAngles, anglesPath.c_str());
  }
  if (streamAngles.streamAvailable()) {
    // When delta arrives, fetch the FULL node
    if (Firebase.RTDB.getJSON(&fbdoData, anglesPath.c_str())) {
      FirebaseJson json = fbdoData.jsonObject();
      parseAnglesData(&json);
      updateHardware();
    }
  }

  // 3. Device heartbeat every 5 seconds
  if (millis() - sendDataPrevMillis > 5000 || sendDataPrevMillis == 0) {
    sendDataPrevMillis = millis();
    
    FirebaseJson statusJson;
    statusJson.set("online", true);
    statusJson.set("wifiConnected", WiFi.status() == WL_CONNECTED);
    statusJson.set("firebaseConnected", Firebase.ready());
    statusJson.set("ipAddress", WiFi.localIP().toString());
    statusJson.set("rssi", WiFi.RSSI());
    statusJson.set("firmwareVersion", "1.0.1");
    
    // updateNodeAsync merges data instead of overwriting the entire node with a single string
    Firebase.RTDB.updateNodeAsync(&fbdoData, statusPath.c_str(), &statusJson);
  }
}
