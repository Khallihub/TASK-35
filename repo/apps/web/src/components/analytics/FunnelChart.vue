<script setup lang="ts">
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js'
import { type FunnelData } from '@/api/analytics'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const props = defineProps<{ funnel: FunnelData }>()

const chartData = computed(() => ({
  labels: ['Draft', 'Approved', 'Published'],
  datasets: [
    {
      label: 'Listings',
      data: [props.funnel.draft, props.funnel.approved, props.funnel.published],
      backgroundColor: [
        'rgba(108, 117, 125, 0.7)',
        'rgba(45, 125, 210, 0.7)',
        'rgba(40, 167, 69, 0.7)',
      ],
      borderColor: [
        'rgba(108, 117, 125, 1)',
        'rgba(45, 125, 210, 1)',
        'rgba(40, 167, 69, 1)',
      ],
      borderWidth: 1,
    },
  ],
}))

const chartOptions = computed(() => ({
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { enabled: true },
  },
  scales: {
    x: { beginAtZero: true },
  },
}))
</script>

<template>
  <div style="height: 200px;">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
