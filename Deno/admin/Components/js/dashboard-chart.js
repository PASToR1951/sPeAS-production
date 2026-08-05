/**
 * Dashboard Chart Component
 * 
 * This script handles the visitor chart functionality in the admin dashboard.
 * It fetches real visitor data from the API and displays it in a chart.
 */

// Chart instance reference
let visitorChart = null;

// Function to fetch visitor data from the API
async function fetchVisitorData(period) {
    try {
                
        let apiEndpoint;
        switch(period) {
            case 'daily':
                apiEndpoint = '/api/page-visits/stats/daily';
                break;
            case 'weekly':
                apiEndpoint = '/api/page-visits/stats/weekly';
                break;
            case 'monthly':
                apiEndpoint = '/api/page-visits/stats/monthly';
                break;
            default:
                apiEndpoint = '/api/page-visits/stats/daily'; // Default to daily
        }
        
        // Try the specific period endpoint first
        const response = await fetch(apiEndpoint);
        
        if (response.ok) {
            const data = await response.json();
                        
            if (data && data.data && data.data.length > 0) {
                return formatApiData(data, period);
            }
        }
        
        // If specific period endpoint fails, try the general stats endpoint
                const generalResponse = await fetch('/api/page-visits/stats');
        
        if (generalResponse.ok) {
            const generalData = await generalResponse.json();
                        
            // Try to extract data from general stats
            if (generalData) {
                // Try different formats that might be returned by the API
                
                // Format 1: If period data is directly available
                if (generalData[period] && Array.isArray(generalData[period])) {
                                        return formatApiData({ data: generalData[period] }, period);
                }
                
                // Format 2: If data is in stats property
                if (generalData.stats) {
                                        
                    // If we have the total/guest/user format like in the visits-column
                    if (typeof generalData.stats.total !== 'undefined' && 
                        typeof generalData.stats.guest !== 'undefined' && 
                        typeof generalData.stats.user !== 'undefined') {
                        
                                                
                        // Generate a simple one-point dataset
                        const today = new Date();
                        const formattedDate = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        
                        return {
                            labels: [formattedDate],
                            userVisits: [generalData.stats.user],
                            guestVisits: [generalData.stats.guest]
                        };
                    }
                }
                
                // Format 3: If historical data exists
                if (generalData.history && Array.isArray(generalData.history)) {
                                        return formatApiData({ data: generalData.history }, period);
                }
                
                // Format 4: Try to use daily_stats, weekly_stats, or monthly_stats if available
                const altFieldName = `${period}_stats`;
                if (generalData[altFieldName] && Array.isArray(generalData[altFieldName])) {
                                        return formatApiData({ data: generalData[altFieldName] }, period);
                }
                
                // Format 5: If there's a data array at the root
                if (Array.isArray(generalData.data)) {
                                        return formatApiData({ data: generalData.data }, period);
                }
                
                // Last resort - if we have any numeric data, create a simple chart
                if (generalData.stats && (
                    typeof generalData.stats.total === 'number' || 
                    typeof generalData.stats.guest === 'number' || 
                    typeof generalData.stats.user === 'number'
                )) {
                                        
                    // Use home page stats to create a simple one-point dataset
                    const today = new Date();
                    const formattedDate = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    
                    return {
                        labels: ['Current'],
                        userVisits: [generalData.stats.user || 0],
                        guestVisits: [generalData.stats.guest || 0]
                    };
                }
            }
        }
        
        // Try the home-stats endpoint as a last resort (this is what visits-column uses)
                const homeStatsResponse = await fetch('/api/page-visits/home-stats');
        
        if (homeStatsResponse.ok) {
            const homeStatsData = await homeStatsResponse.json();
                        
            if (homeStatsData && homeStatsData.stats) {
                // Use home page stats to create a simple one-point dataset
                const today = new Date();
                const formattedDate = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                
                return {
                    labels: ['Current'],
                    userVisits: [homeStatsData.stats.user || 0],
                    guestVisits: [homeStatsData.stats.guest || 0]
                };
            }
        }
        
        // If all API calls fail, return empty data
                return { labels: [], userVisits: [], guestVisits: [] };
    } catch (error) {
        return { labels: [], userVisits: [], guestVisits: [] };
    }
}

// Function to format API data for chart use
function formatApiData(apiData, period) {
    // Extract relevant data from API response
    const chartData = {
        labels: [],
        userVisits: [],
        guestVisits: []
    };
    
    // Different formatting based on the period
    if (apiData && apiData.data && apiData.data.length > 0) {
        apiData.data.forEach(item => {
            // Format date label based on period
            let label;
            switch(period) {
                case 'daily':
                    // Format as "Jun 5"
                    const date = new Date(item.date);
                    label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    break;
                case 'weekly':
                    // Format as "Week 23"
                    label = `Week ${item.week || item.period}`;
                    break;
                case 'monthly':
                    // Format as "Jun 2023"
                    label = item.month || item.period;
                    break;
                default:
                    label = item.period || item.date;
            }
            
            chartData.labels.push(label);
            chartData.userVisits.push(item.user_visits || 0);
            chartData.guestVisits.push(item.guest_visits || 0);
        });
    }
    
    return chartData;
}

// Function to create or update the chart
async function updateVisitorChart(period = 'daily') {
    try {
        // Fetch data for the selected period
        const chartData = await fetchVisitorData(period);
        
        // Get the canvas context
        const ctx = document.getElementById('visitorChart').getContext('2d');
        
        // If chart exists, destroy it before creating a new one
        if (visitorChart) {
            visitorChart.destroy();
        }
        
        // Check if we received any data
        if (chartData.labels.length === 0) {
            // Display a "No Data Available" message on the canvas
            visitorChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['No Data'],
                    datasets: [{
                        data: [0],
                        backgroundColor: 'rgba(0,0,0,0)',
                        borderColor: 'rgba(0,0,0,0)'
                    }]
                },
                options: {
                    responsive: true,
                    resizeDelay: 250,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        title: {
                            display: true,
                            text: 'No Data Available',
                            color: '#666',
                            font: {
                                size: 16
                            }
                        },
                        tooltip: {
                            enabled: false
                        }
                    },
                    scales: {
                        x: {
                            display: false
                        },
                        y: {
                            display: false
                        }
                    }
                }
            });
            
            // Update button active state
            const buttons = document.querySelectorAll('.chart-header button');
            buttons.forEach(button => button.classList.remove('active'));
            document.querySelector(`.chart-header button[data-period="${period}"]`).classList.add('active');
            
            return;
        }
        
        // Brand colors
        const BRAND_GREEN = '#006A4E';
        const ACCENT_BLUE = '#2563eb';

        // Gradient fills for the line areas
        const ctxCanvas = ctx;
        const chartHeight = ctxCanvas.canvas.height || 260;
        const userGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
        userGradient.addColorStop(0, 'rgba(0, 106, 78, 0.28)');
        userGradient.addColorStop(1, 'rgba(0, 106, 78, 0.00)');
        const guestGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
        guestGradient.addColorStop(0, 'rgba(37, 99, 235, 0.22)');
        guestGradient.addColorStop(1, 'rgba(37, 99, 235, 0.00)');

        // Create new chart with real data
        visitorChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: 'User Visits',
                    data: chartData.userVisits,
                    backgroundColor: userGradient,
                    borderColor: BRAND_GREEN,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: '#E6E6E6',
                    pointHoverBorderColor: BRAND_GREEN,
                    pointHoverBorderWidth: 2
                }, {
                    label: 'Guest Visits',
                    data: chartData.guestVisits,
                    backgroundColor: guestGradient,
                    borderColor: ACCENT_BLUE,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: '#E6E6E6',
                    pointHoverBorderColor: ACCENT_BLUE,
                    pointHoverBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                    resizeDelay: 250,
                maintainAspectRatio: false,
                devicePixelRatio: window.devicePixelRatio,
                interaction: { mode: 'index', intersect: false },
                animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? { duration: 0 }
                    : { duration: 700, easing: 'easeOutQuart' },
                scales: {
                    y: {
                        beginAtZero: true,
                        border: { display: false },
                        ticks: {
                            color: '#94a3b8',
                            font: { family: 'Inter, sans-serif', size: 11 },
                            padding: 8
                        },
                        grid: {
                            color: '#eef0f3',
                            drawBorder: false,
                            tickBorderDash: [4, 4],
                            tickLength: 0
                        }
                    },
                    x: {
                        border: { display: false },
                        ticks: {
                            color: '#94a3b8',
                            font: { family: 'Inter, sans-serif', size: 11 },
                            padding: 8
                        },
                        grid: { display: false, drawBorder: false }
                    }
                },
                plugins: {
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(15, 23, 42, 0.92)',
                        titleColor: '#E6E6E6',
                        bodyColor: '#e2e8f0',
                        titleFont: { family: 'Inter, sans-serif', weight: '600', size: 12 },
                        bodyFont: { family: 'Inter, sans-serif', size: 12 },
                        padding: 12,
                        cornerRadius: 10,
                        borderColor: 'rgba(255, 255, 255, 0.08)',
                        borderWidth: 1,
                        displayColors: true,
                        boxPadding: 4,
                        usePointStyle: true,
                        callbacks: {
                            labelColor: function(context) {
                                if (context.datasetIndex === 0) {
                                    return { borderColor: BRAND_GREEN, backgroundColor: BRAND_GREEN };
                                }
                                return { borderColor: ACCENT_BLUE, backgroundColor: ACCENT_BLUE };
                            },
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += Number(context.parsed.y).toLocaleString() + ' visits';
                                }
                                return label;
                            }
                        }
                    },
                    legend: {
                        position: 'bottom',
                        align: 'end',
                        labels: {
                            color: '#475569',
                            font: { family: 'Inter, sans-serif', size: 12, weight: '500' },
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 8,
                            boxHeight: 8,
                            padding: 14
                        }
                    }
                }
            }
        });
        
        // Update button active state
        const buttons = document.querySelectorAll('.chart-header button');
        buttons.forEach(button => button.classList.remove('active'));
        document.querySelector(`.chart-header button[data-period="${period}"]`).classList.add('active');
    } catch (error) {
        // Display error in chart
        try {
            const ctx = document.getElementById('visitorChart').getContext('2d');
            if (visitorChart) visitorChart.destroy();
            
            visitorChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['Error'],
                    datasets: [{
                        data: [0],
                        backgroundColor: 'rgba(0,0,0,0)',
                        borderColor: 'rgba(0,0,0,0)'
                    }]
                },
                options: {
                    responsive: true,
                    resizeDelay: 250,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        title: {
                            display: true,
                            text: 'Error Loading Chart Data',
                            color: '#d32f2f',
                            font: {
                                size: 16
                            }
                        },
                        tooltip: {
                            enabled: false
                        }
                    },
                    scales: {
                        x: {
                            display: false
                        },
                        y: {
                            display: false
                        }
                    }
                }
            });
        } catch (chartError) {
        }
    }
}

// Initialize chart when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
        
    // Add a small delay to ensure Chart.js is fully loaded
    setTimeout(() => {
        // Initial chart update with default period (daily)
        updateVisitorChart('daily');
        
        // Add event listeners to period buttons
        document.querySelectorAll('.chart-header button').forEach(button => {
            button.addEventListener('click', (event) => {
                const period = event.target.getAttribute('data-period');
                updateVisitorChart(period);
            });
        });
    }, 300); // Small delay to ensure Chart.js and DOM are fully loaded
});

// Retry chart rendering if it fails or canvas is not ready
function retryChartRendering() {
    const canvas = document.getElementById('visitorChart');
    if (!canvas) {
        setTimeout(() => updateVisitorChart('daily'), 500);
        return;
    }
    
    // Check if Chart.js is available
    if (typeof Chart === 'undefined') {
        setTimeout(() => updateVisitorChart('daily'), 500);
        return;
    }
    
    updateVisitorChart('daily');
}

// Add a global error handler to retry the chart if it fails to render
window.addEventListener('error', function(event) {
    if (event.message && event.message.includes('Chart') && visitorChart === null) {
        setTimeout(retryChartRendering, 1000);
    }
});

// Add a fallback timeout to ensure chart renders even if DOMContentLoaded doesn't fire properly
setTimeout(() => {
    if (visitorChart === null) {
        retryChartRendering();
    }
}, 1000);

// Expose updateVisitorChart to the global scope for debugging
window.updateVisitorChart = updateVisitorChart; 