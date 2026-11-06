# =============================================================================
# Smart Tolling SceneScape Adapter - Shared helpers
# =============================================================================
# Code shared verbatim between sscape_adapter_lpr_max_tracking.py and
# sscape_adapter_side_max_tracking.py. Extracted to remove duplication; no
# behavioral change versus the code previously inlined in each adapter file.
# =============================================================================

import base64
import json
import logging
import os
import time
from datetime import datetime
from uuid import getnode as get_mac

import cv2
import ntplib
import paho.mqtt.client as mqtt
from pytz import timezone

ROOT_CA = os.environ.get('ROOT_CA', '/run/secrets/certs/scenescape-ca.pem')
DATETIME_FORMAT = "%Y-%m-%dT%H:%M:%S.%f"
TIMEZONE = "UTC"
DEBUG_MODE = os.environ.get('DEBUG_ADAPTER', 'false').lower() == 'true'


def getMACAddress():
    if 'MACADDR' in os.environ:
        return os.environ['MACADDR']
    a = get_mac()
    h = iter(hex(a)[2:].zfill(12))
    return ":".join(i + next(h) for i in h)


def computeObjBoundingBoxParams(pobj, fw, fh, x, y, w, h, xminnorm=None, yminnorm=None, xmaxnorm=None, ymaxnorm=None):
    try:
        xmax, xmin = int(xmaxnorm * fw), int(xminnorm * fw)
        ymax, ymin = int(ymaxnorm * fh), int(yminnorm * fh)
    except Exception:
        xmin, ymin, xmax, ymax = x, y, x + w, y + h

    comw, comh = (xmax - xmin) / 3, (ymax - ymin) / 4
    pobj.update({
        'center_of_mass': {'x': int(xmin + comw), 'y': int(ymin + comh), 'width': comw, 'height': comh},
        'bounding_box_px': {'x': x, 'y': y, 'width': w, 'height': h}
    })


def normalize_detections(objects):
    """Backfill label/confidence/width/height/object_id from alternate field names."""
    for det in objects:
        if 'detection' in det:
            d = det['detection']
            if 'label' not in det:
                det['label'] = d.get('label')
            if 'confidence' not in det:
                det['confidence'] = d.get('confidence')
        if 'w' in det and 'width' not in det:
            det['width'] = det['w']
        if 'h' in det and 'height' not in det:
            det['height'] = det['h']
        if det.get('object_id') is None and det.get('id') is not None:
            det['object_id'] = det.get('id')


def apply_default_vehicle_label(objects):
    """Detections with an object_id but no label are assumed to be vehicles."""
    for det in objects:
        if det.get('label') is None and det.get('object_id') is not None:
            det['label'] = 'vehicle'


def publish_frame_result(publisher, frame, imgdatadict):
    """Publish captured images (if requested) and the frame-level MQTT payload."""
    if publisher.is_publish_image:
        publisher.buildImgData(imgdatadict, frame, True)
        if imgdatadict.get('image') is not None:
            publisher.client.publish(f"scenescape/image/camera/{publisher.cameraid}", json.dumps(imgdatadict))
        publisher.is_publish_image = False

    if publisher.is_publish_calibration_image:
        if not imgdatadict:
            publisher.buildImgData(imgdatadict, frame, False)
        if imgdatadict.get('image') is not None:
            publisher.client.publish(f"scenescape/image/calibration/camera/{publisher.cameraid}", json.dumps(imgdatadict))
        publisher.is_publish_calibration_image = False

    final_payload = json.dumps(publisher.frame_level_data)
    try:
        if DEBUG_MODE:
            print("FINAL MQTT PAYLOAD:", json.dumps(publisher.frame_level_data, indent=2))
        publisher.client.publish(f"scenescape/data/camera/{publisher.cameraid}", final_payload)
    except Exception as e:
        publisher.log.error(f"Failed to publish to MQTT: {e}")

    try:
        frame.add_message(final_payload)
    except Exception:
        pass


class PostDecodeTimestampCapture:
    """Adds NTP-synchronized timestamps to each frame before inference.

    Subclasses may override LOGGER_NAME to namespace log output per adapter.
    """

    LOGGER_NAME = 'SSCAPE_ADAPTER'

    def __init__(self, ntpServer=None):
        self.log = logging.getLogger(self.LOGGER_NAME)
        self.log.setLevel(logging.INFO)
        self.ntpClient = ntplib.NTPClient()
        self.ntpServer = ntpServer
        self.lastTimeSync = None
        self.timeOffset = 0
        self.timestamp_for_next_block = None
        self.fps = 5.0
        self.fps_alpha = 0.75
        self.last_calculated_fps_ts = None
        self.fps_calc_interval = 1
        self.frame_cnt = 0

    def processFrame(self, frame):
        wall = time.time()
        self.frame_cnt += 1
        if not self.last_calculated_fps_ts:
            self.last_calculated_fps_ts = wall
        if (wall - self.last_calculated_fps_ts) > self.fps_calc_interval:
            self.fps = self.fps * self.fps_alpha + (1 - self.fps_alpha) * (self.frame_cnt / (wall - self.last_calculated_fps_ts))
            self.last_calculated_fps_ts = wall
            self.frame_cnt = 0

        if self.ntpServer:
            if not self.lastTimeSync or wall - self.lastTimeSync > 1000:
                response = self.ntpClient.request(host=self.ntpServer, port=123)
                self.timeOffset = response.offset
                self.lastTimeSync = wall

        # Always use wall-clock time (not the buffer's video-content PTS): PTS advances at
        # the source's nominal encoded rate regardless of actual processing throughput, so
        # anchoring to it drifts further behind real time, without bound, whenever the
        # pipeline can't sustain that nominal rate -- which is exactly when the scenescape
        # controller's staleness check then discards every frame as permanently "too old".
        now = wall + self.timeOffset
        self.timestamp_for_next_block = now
        frame.add_message(json.dumps({
            'postdecode_timestamp': f"{datetime.fromtimestamp(now, tz=timezone(TIMEZONE)).strftime(DATETIME_FORMAT)[:-3]}Z",
            'timestamp_for_next_block': now,
            'fps': self.fps
        }))
        return True


class PostInferenceDataPublishBase:
    """Shared MQTT/image/annotation plumbing for SceneScape metadata publishers.

    Subclasses provide LOGGER_NAME, their own __init__ (calling super().__init__),
    buildObjData(), and processFrame().
    """

    LOGGER_NAME = 'SSCAPE_ADAPTER'

    def __init__(self, cameraid, publish_image=False):
        self.log = logging.getLogger(self.LOGGER_NAME)
        self.log.setLevel(logging.INFO)
        self.cameraid = cameraid
        self.is_publish_image = publish_image
        self.is_publish_calibration_image = False
        self.frame_level_data = {'id': cameraid, 'debug_mac': getMACAddress()}
        self.setupMQTT()

    def on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            print(f"Connected to MQTT Broker {self.broker}")
            self.client.subscribe(f"scenescape/cmd/camera/{self.cameraid}")
            print(f"Subscribed to topic: scenescape/cmd/camera/{self.cameraid}")
        else:
            print(f"Failed to connect, return code {rc}")

    def setupMQTT(self):
        self.client = mqtt.Client()
        self.client.on_connect = self.on_connect
        self.broker = os.environ.get('MQTT_BROKER', 'broker.scenescape.intel.com')
        try:
            self.client.connect(self.broker, int(os.environ.get('MQTT_PORT', '1883')), 120)
        except Exception as e:
            self.log.error(f"Failed to connect to MQTT broker {self.broker}: {e}")
        self.client.on_message = self.handleCameraMessage
        if ROOT_CA and os.path.exists(ROOT_CA):
            self.client.tls_set(ca_certs=ROOT_CA)
        self.client.loop_start()

    def handleCameraMessage(self, client, userdata, message):
        msg = str(message.payload.decode("utf-8"))
        if msg == "getimage":
            self.is_publish_image = True
        elif msg == "getcalibrationimage":
            self.is_publish_calibration_image = True

    def annotateObjects(self, img):
        objColors = ((0, 0, 255), (255, 128, 128), (207, 83, 255), (31, 156, 238))
        for otype, objects in self.frame_level_data.get('objects', {}).items():
            if otype == "person":
                cindex = 0
            elif otype in ("vehicle", "bicycle", "license_plate", "sedan", "truck", "bus"):
                cindex = 1
            else:
                cindex = 2
            for obj in objects:
                try:
                    topleft_cv = (int(obj['bounding_box_px']['x']), int(obj['bounding_box_px']['y']))
                    bottomright_cv = (int(obj['bounding_box_px']['x'] + obj['bounding_box_px']['width']),
                                      int(obj['bounding_box_px']['y'] + obj['bounding_box_px']['height']))
                    cv2.rectangle(img, topleft_cv, bottomright_cv, objColors[cindex], 4)
                except Exception:
                    continue

    def annotateFPS(self, img, fpsval):
        fpsStr = f'FPS {fpsval:.1f}'
        scale = int((img.shape[0] + 479) / 480)
        cv2.putText(img, fpsStr, (0, 30 * scale), cv2.FONT_HERSHEY_SIMPLEX,
                    1 * scale, (0, 0, 0), 5 * scale)
        cv2.putText(img, fpsStr, (0, 30 * scale), cv2.FONT_HERSHEY_SIMPLEX,
                    1 * scale, (255, 255, 255), 2 * scale)

    def buildImgData(self, imgdatadict, gvaframe, annotate):
        """Build image data with error handling for corrupted buffers"""
        imgdatadict.update({
            'timestamp': self.frame_level_data.get('timestamp'),
            'id': self.cameraid
        })
        try:
            with gvaframe.data() as image:
                if annotate:
                    self.annotateObjects(image)
                    self.annotateFPS(image, self.frame_level_data.get('rate', 0.0))
                _, jpeg = cv2.imencode(".jpg", image)
            jpeg = base64.b64encode(jpeg).decode('utf-8')
            imgdatadict['image'] = jpeg
        except RuntimeError as e:
            self.log.error(f"Failed to build image data: {e}")
            imgdatadict['image'] = None
