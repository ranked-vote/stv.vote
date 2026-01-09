<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<svelte:head>
	<link rel="stylesheet" href="/card.css" />
</svelte:head>

<div class="card homepage-card">
	<div class="homepage-content">
		<div class="branding">
			<h1 class="site-name">stv.vote</h1>
			<p class="tagline">Detailed reports on Single Transferable Vote elections</p>
		</div>

		<div class="stats">
			<div class="stat">
				<span class="stat-number">{data.totalContests}</span>
				<span class="stat-label">Election Reports</span>
			</div>
			<div class="stat">
				<span class="stat-number">{data.totalJurisdictions}</span>
				<span class="stat-label">Jurisdictions</span>
			</div>
		</div>

		<div class="visual">
			<svg viewBox="0 0 400 200" class="flow-diagram">
				<!-- Stylized Sankey-like flow visualization -->
				<defs>
					<linearGradient id="flow1" x1="0%" y1="0%" x2="100%" y2="0%">
						<stop offset="0%" style="stop-color:#0d4aaa;stop-opacity:0.8" />
						<stop offset="100%" style="stop-color:#3b82f6;stop-opacity:0.6" />
					</linearGradient>
					<linearGradient id="flow2" x1="0%" y1="0%" x2="100%" y2="0%">
						<stop offset="0%" style="stop-color:#059669;stop-opacity:0.8" />
						<stop offset="100%" style="stop-color:#10b981;stop-opacity:0.6" />
					</linearGradient>
					<linearGradient id="flow3" x1="0%" y1="0%" x2="100%" y2="0%">
						<stop offset="0%" style="stop-color:#d97706;stop-opacity:0.8" />
						<stop offset="100%" style="stop-color:#f59e0b;stop-opacity:0.6" />
					</linearGradient>
				</defs>
				
				<!-- Left nodes -->
				<rect x="0" y="10" width="20" height="50" fill="#0d4aaa" rx="3"/>
				<rect x="0" y="70" width="20" height="40" fill="#059669" rx="3"/>
				<rect x="0" y="120" width="20" height="35" fill="#d97706" rx="3"/>
				<rect x="0" y="165" width="20" height="25" fill="#7c3aed" rx="3"/>
				
				<!-- Flow paths -->
				<path d="M 20 35 C 100 35, 100 30, 180 30" stroke="url(#flow1)" stroke-width="40" fill="none" opacity="0.7"/>
				<path d="M 20 90 C 80 90, 120 55, 180 55" stroke="url(#flow2)" stroke-width="25" fill="none" opacity="0.7"/>
				<path d="M 20 137 C 80 137, 100 75, 180 75" stroke="url(#flow3)" stroke-width="20" fill="none" opacity="0.7"/>
				
				<!-- Middle nodes -->
				<rect x="180" y="15" width="20" height="75" fill="#0d4aaa" rx="3"/>
				<rect x="180" y="100" width="20" height="30" fill="#7c3aed" rx="3"/>
				<rect x="180" y="140" width="20" height="25" fill="#94a3b8" rx="3"/>
				
				<!-- Second flow -->
				<path d="M 200 52 C 280 52, 280 45, 360 45" stroke="url(#flow1)" stroke-width="55" fill="none" opacity="0.7"/>
				<path d="M 200 115 C 260 115, 280 85, 360 85" stroke="#7c3aed" stroke-width="18" fill="none" opacity="0.5"/>
				
				<!-- Right node (winner) -->
				<rect x="360" y="20" width="25" height="90" fill="#0d4aaa" rx="3"/>
				<rect x="360" y="120" width="25" height="40" fill="#94a3b8" rx="3"/>
			</svg>
		</div>
	</div>
</div>

<style>
	.homepage-card {
		background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
		position: relative;
	}

	.homepage-content {
		display: flex;
		flex-direction: row;
		height: 100%;
		padding: 50px 60px;
		box-sizing: border-box;
		gap: 40px;
	}

	.branding {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.site-name {
		font-size: 96px;
		font-weight: 800;
		color: #0d4aaa;
		margin: 0;
		line-height: 1;
		letter-spacing: -2px;
	}

	.tagline {
		font-size: 28px;
		color: #475569;
		margin: 20px 0 0 0;
		line-height: 1.3;
		max-width: 500px;
	}

	.stats {
		display: flex;
		gap: 50px;
		margin-top: 40px;
	}

	.stat {
		display: flex;
		flex-direction: column;
	}

	.stat-number {
		font-size: 64px;
		font-weight: 700;
		color: #0d4aaa;
		line-height: 1;
	}

	.stat-label {
		font-size: 18px;
		color: #64748b;
		margin-top: 8px;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.visual {
		flex: 0 0 420px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.flow-diagram {
		width: 100%;
		height: auto;
		max-height: 280px;
	}
</style>
