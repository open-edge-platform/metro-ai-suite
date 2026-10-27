<template>
  <div class="container">
    <div id="map-wrapper">
      <div id="map"></div>
      <div id="qr-overlay">
        <img
          src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUgAAAFIAQMAAAAI2vVwAAAABlBMVEUAAAD///+l2Z/dAAAAAnRSTlP//8i138cAAAAJcEhZcwAACxIAAAsSAdLdfvwAAAGuSURBVGiB7dXBcgIxDANQ//9PqwO2FDNTGIVDe1Eo6e7mhYMjTMEdFRn5H7J6PG9mftxV32s10pVT2HHP2zOXyh7pykdl9YSPeApcjbyUz3llVumO/EpO8XH82zOK/Ci5DtZ+zUp4pCvnt+nN65ffuMhPUqMfcDtm0mqkJ6fuU/yjpt79irQlFOMC9+ygs01EerJ0W3iNr7aiIm3J/GKFm36YzijSkCr/gJI5xY+0ZVGACtN8sT4m0pW7xBTdZnnLphtpSXB1N4bZflikKXuZLaAhVO+XzhDpyILSywCzR0hE+hLr+8+N+oTZG3khMemd62kJ4HGcE4g0pGrNFHNrj/4faUumljWmAdMMviMd2XE9byVZHDyjSEPWvmJfOKeA1UMiTQmld6nS44q8kGDBMUfQe1juOZFIW66lrrfm5zacyke6kuWd7jCLxT2RF3IKyx5b50p9IdKWHMqrBpjnyAt5HnOGekSdNEe6UkdQa2Jn0OFE2nJqzIVidl8DHXkrp+euMKP4F/mNnAjvDPfDyAsJBXgyDF5MwhF5Idf3v7r0Oo/THSJdaY7IyL+XP0fLC5slbWBVAAAAAElFTkSuQmCC"
          alt="QR code linking to the image-based-video-search documentation"
        />
        <a
          href="https://docs.openedgeplatform.intel.com/dev/edge-ai-suites/image-based-video-search/index.html"
          target="_blank"
          rel="noopener noreferrer"
        >IBVS Documentation</a>
      </div>
    </div>
    <div id="text">
      <Screenshot />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import Screenshot from './Screenshot.vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default defineComponent({
  name: 'MapView',
  components: {
    Screenshot,
  },
  data() {
    return {
      map: null as L.Map | null,
    };
  },
  mounted() {
    this.initMap();
    window.addEventListener('resize', this.resizeMap);
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.resizeMap);
  },
  methods: {
    initMap() {
      this.map = L.map('map').setView([33.4484, -112.0740], 25); // Phoenix coordinates

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(this.map as L.Map);

      L.marker(
        [33.4484, -112.0740]
      ).addTo(this.map as L.Map)
        .bindPopup('11 N Central Ave #4, Phoenix, AZ')
        .openPopup();

      this.resizeMap();
    },
    resizeMap() {
      if (this.map) {
        this.map.invalidateSize();
      }
    }
  }
});
</script>

<style>
@import 'leaflet/dist/leaflet.css';

html, body {
  height: 100%;
  margin: 0;
}

.container {
  display: flex;
  align-items: flex-start; /* Align items at the top */
  justify-content: flex-start; /* Optional: Align horizontally to the start */
  height: 100vh;
  width: 100vw;
}

#map-wrapper {
  position: relative;
  width: 65%;
  height: 100%;
}

#map {
  width: 100%;
  height: 100%;
}

#qr-overlay {
  position: absolute;
  bottom: 16px;
  left: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(255, 255, 255, 0.92);
  padding: 8px;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

#qr-overlay img {
  width: 100px;
  height: 100px;
}

#qr-overlay a {
  margin-top: 4px;
  font-size: 11px;
  text-align: center;
  color: #0066cc;
  text-decoration: none;
}

#text {
  width: 35%;
  height: 100%;
  display: flex;
  flex-direction: column; /* Ensure the iframe is aligned vertically */
  align-items: flex-start; /* Align items to the top */
  justify-content: flex-start; /* Align items to the top */
}

#text p {
 
  text-align: center;
}
</style>