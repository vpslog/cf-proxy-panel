const { createApp, ref, computed, onMounted } = Vue;

const PROJECT_REPO_URL = 'https://github.com/vpslog/cf-proxy-panel';
const INSTALLER_URL = 'https://raw.githubusercontent.com/vpslog/cf-proxy-panel/main/install.sh';
const INSTALL_SETTINGS_KEY = 'cf_proxy_panel_install_settings';

const DEFAULT_INSTALL_SETTINGS = {
  mode: 'reality',
  realityPort: '443',
  realitySni: 'www.amazon.com',
  cfToken: '',
  cfZoneId: '',
  cfAccountId: '',
  rootDomain: '',
  wssDomain: '',
  wssPort: '443',
  wssPath: ''
};

const app = createApp({
  template: '#app-template',
  setup() {
    const tokenInput = ref(getAuthToken());
    const authed = ref(Boolean(getAuthToken()));
    const profiles = ref([]);
    const draftAlias = ref('');
    const draftUrl = ref('');
    const exportTarget = ref('clash');
    const settings = ref({ remoteRuleUrl: '', extraRuleGroups: [] });
    const editingRuleGroups = ref([]);
    const advancedRulesOpen = ref(false);
    const installSettings = ref(loadInstallSettings());
    const installDraft = ref({ ...installSettings.value });
    const installSettingsOpen = ref(false);
    const loading = ref(false);
    const savingId = ref('');
    const notice = ref('');
    const error = ref('');
    const importFileInput = ref(null);

    const enabledCount = computed(() => profiles.value.filter((profile) => profile.enabled).length);
    const canAdd = computed(() => draftAlias.value.trim() && draftUrl.value.trim());
    const extraRuleCount = computed(() => normalizeRuleGroups(settings.value.extraRuleGroups).length);
    const installModeLabel = computed(() => installSettings.value.mode === 'wss' ? 'WSS' : 'Reality');
    const installCommand = computed(() => {
      const env = {
        SUBCONVERT_NON_INTERACTIVE: '1',
        INSTALL_MODE: installSettings.value.mode || 'reality',
        SUBCONVERT_WEB_URL: window.location.origin,
        SUBCONVERT_TOKEN: getAuthToken(),
        SUBCONVERT_ALIAS: '$(hostname)'
      };

      if (env.INSTALL_MODE === 'wss') {
        Object.assign(env, {
          CF_API_TOKEN: installSettings.value.cfToken,
          CF_ZONE_ID: installSettings.value.cfZoneId,
          CF_ACCOUNT_ID: installSettings.value.cfAccountId,
          WSS_ROOT_DOMAIN: installSettings.value.rootDomain,
          WSS_DOMAIN: installSettings.value.wssDomain,
          WSS_PORT: installSettings.value.wssPort || '443',
          WSS_PATH: installSettings.value.wssPath
        });
      } else {
        Object.assign(env, {
          REALITY_PORT: installSettings.value.realityPort || '443',
          REALITY_SNI: installSettings.value.realitySni || 'www.amazon.com'
        });
      }

      const envText = Object.entries(env)
        .filter(([, value]) => String(value || '').trim())
        .map(([key, value]) => key === 'SUBCONVERT_ALIAS' && value === '$(hostname)'
          ? 'SUBCONVERT_ALIAS="$(hostname)"'
          : `${key}=${shellQuote(value)}`)
        .join(' ');

      return `curl -fsSL ${INSTALLER_URL} -o /tmp/cf-proxy-panel-install.sh && sudo env ${envText} bash /tmp/cf-proxy-panel-install.sh`;
    });

    function loadInstallSettings() {
      try {
        return {
          ...DEFAULT_INSTALL_SETTINGS,
          ...JSON.parse(localStorage.getItem(INSTALL_SETTINGS_KEY) || '{}')
        };
      } catch {
        return { ...DEFAULT_INSTALL_SETTINGS };
      }
    }

    function normalizeRuleGroups(groups = []) {
      return Array.isArray(groups)
        ? groups
            .map((group) => ({
              name: String(group.name || '').trim(),
              content: String(group.content || '').trim()
            }))
            .filter((group) => group.name && group.content)
        : [];
    }

    function shellQuote(value) {
      return `'${String(value).replace(/'/g, `'\\''`)}'`;
    }

    function flash(message, isError = false) {
      notice.value = isError ? '' : message;
      error.value = isError ? message : '';

      window.clearTimeout(flash.timer);
      flash.timer = window.setTimeout(() => {
        notice.value = '';
        error.value = '';
      }, 2600);
    }

    function withToken(url) {
      const token = getAuthToken();
      if (!token) {
        return url;
      }

      const parsed = new URL(url, window.location.origin);
      parsed.searchParams.set('token', token);
      return parsed.toString();
    }

    function exportUrl(profile) {
      const params = new URLSearchParams({ target: exportTarget.value });
      if (profile) {
        params.set('id', profile.id);
      }

      return withToken(`${window.location.origin}/subscribe?${params.toString()}`);
    }

    async function copyText(text, message) {
      await navigator.clipboard.writeText(text);
      flash(message);
    }

    async function loadData() {
      if (!authed.value) {
        return;
      }

      loading.value = true;
      try {
        const [profileData, settingsData] = await Promise.all([
          loadProfiles(),
          loadSettings()
        ]);
        profiles.value = profileData;
        settings.value = {
          remoteRuleUrl: settingsData.remoteRuleUrl || '',
          extraRuleGroups: normalizeRuleGroups(settingsData.extraRuleGroups)
        };
      } catch (e) {
        if (e.message === 'UNAUTHORIZED') {
          authed.value = false;
          flash('访问令牌无效，请重新验证。', true);
        } else {
          flash('数据加载失败，请稍后重试。', true);
        }
      } finally {
        loading.value = false;
      }
    }

    async function unlock() {
      const token = tokenInput.value.trim();
      if (!token) {
        flash('请输入访问令牌。', true);
        return;
      }

      setAuthToken(token);
      authed.value = true;
      await loadData();
    }

    function lock() {
      clearAuthToken();
      tokenInput.value = '';
      authed.value = false;
      profiles.value = [];
    }

    async function addNewProfile() {
      if (!canAdd.value) {
        flash('请填写名称和链接。', true);
        return;
      }

      loading.value = true;
      try {
        const created = await addProfile(draftAlias.value.trim(), draftUrl.value.trim());
        profiles.value = [created, ...profiles.value];
        draftAlias.value = '';
        draftUrl.value = '';
        flash('订阅已添加。');
      } catch (e) {
        flash(e.message === 'UNAUTHORIZED' ? '访问令牌无效。' : '订阅添加失败。', true);
      } finally {
        loading.value = false;
      }
    }

    async function saveProfile(profile) {
      if (!profile.alias.trim() || !profile.url.trim()) {
        flash('名称和链接不能为空。', true);
        return;
      }

      savingId.value = profile.id;
      try {
        const updated = await updateProfile(profile.id, {
          alias: profile.alias,
          url: profile.url,
          enabled: profile.enabled
        });
        const index = profiles.value.findIndex((item) => item.id === profile.id);
        if (index >= 0) {
          profiles.value.splice(index, 1, updated);
        }
        flash('订阅已保存。');
      } catch (e) {
        flash(e.message === 'UNAUTHORIZED' ? '访问令牌无效。' : '订阅保存失败。', true);
      } finally {
        savingId.value = '';
      }
    }

    async function saveSystemSettings() {
      loading.value = true;
      try {
        settings.value = await saveSettings({
          ...settings.value,
          extraRuleGroups: normalizeRuleGroups(settings.value.extraRuleGroups)
        });
        flash('规则设置已保存。');
      } catch (e) {
        flash(e.message === 'UNAUTHORIZED' ? '访问令牌无效。' : '规则设置保存失败。', true);
      } finally {
        loading.value = false;
      }
    }

    function openInstallSettings() {
      installDraft.value = { ...installSettings.value };
      installSettingsOpen.value = true;
    }

    function closeInstallSettings() {
      installSettingsOpen.value = false;
    }

    function saveInstallSettings() {
      installSettings.value = {
        ...DEFAULT_INSTALL_SETTINGS,
        ...installDraft.value
      };
      localStorage.setItem(INSTALL_SETTINGS_KEY, JSON.stringify(installSettings.value));
      installSettingsOpen.value = false;
      flash('安装设置已保存。');
    }

    function openAdvancedRules() {
      editingRuleGroups.value = normalizeRuleGroups(settings.value.extraRuleGroups).map((group) => ({ ...group }));
      if (editingRuleGroups.value.length === 0) {
        editingRuleGroups.value.push({ name: '', content: '' });
      }
      advancedRulesOpen.value = true;
    }

    function closeAdvancedRules() {
      advancedRulesOpen.value = false;
    }

    function addExtraRuleGroup() {
      editingRuleGroups.value.push({ name: '', content: '' });
    }

    function removeExtraRuleGroup(index) {
      editingRuleGroups.value.splice(index, 1);
      if (editingRuleGroups.value.length === 0) {
        editingRuleGroups.value.push({ name: '', content: '' });
      }
    }

    async function saveAdvancedRules() {
      settings.value = {
        ...settings.value,
        extraRuleGroups: normalizeRuleGroups(editingRuleGroups.value)
      };
      await saveSystemSettings();
      advancedRulesOpen.value = false;
    }

    async function toggleEnabled(profile) {
      profile.enabled = !profile.enabled;
      await saveProfile(profile);
    }

    async function deleteProf(profile) {
      if (!confirm(`确认删除「${profile.alias}」？`)) {
        return;
      }

      savingId.value = profile.id;
      try {
        await deleteProfile(profile.id);
        profiles.value = profiles.value.filter((item) => item.id !== profile.id);
        flash('订阅已删除。');
      } catch (e) {
        flash(e.message === 'UNAUTHORIZED' ? '访问令牌无效。' : '订阅删除失败。', true);
      } finally {
        savingId.value = '';
      }
    }

    async function exportDb() {
      try {
        const backup = await exportDatabase();
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `cf-proxy-panel-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
        flash('数据库备份已导出。');
      } catch (e) {
        flash(e.message === 'UNAUTHORIZED' ? '访问令牌无效。' : '备份失败。', true);
      }
    }

    function openImportPicker() {
      importFileInput.value?.click();
    }

    async function importDb(event) {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }
      if (!confirm('恢复会替换当前所有节点和规则设置，确认继续？')) {
        return;
      }

      try {
        const backup = JSON.parse(await file.text());
        await importDatabase(backup);
        await loadData();
        flash('数据库已恢复。');
      } catch (e) {
        flash('恢复失败，请确认备份文件格式正确。', true);
      }
    }

    function copyProfileLink(profile) {
      return copyText(exportUrl(profile), '单个订阅链接已复制。');
    }

    function copyAllLinks() {
      return copyText(exportUrl(), '合并订阅链接已复制。');
    }

    function copyInstallCommand() {
      if (installSettings.value.mode === 'wss') {
        if (!installSettings.value.cfToken.trim() || !installSettings.value.rootDomain.trim()) {
          flash('请先在安装高级设置中填写 Cloudflare Token 和主域名。', true);
          return;
        }
      }

      return copyText(installCommand.value, '一键安装命令已复制。');
    }

    function formattedTime(value) {
      return value ? new Date(value).toLocaleString() : '-';
    }

    onMounted(loadData);

    return {
      tokenInput,
      authed,
      profiles,
      draftAlias,
      draftUrl,
      exportTarget,
      settings,
      editingRuleGroups,
      advancedRulesOpen,
      installSettingsOpen,
      installDraft,
      loading,
      savingId,
      notice,
      error,
      importFileInput,
      enabledCount,
      canAdd,
      extraRuleCount,
      installModeLabel,
      installCommand,
      projectRepoUrl: PROJECT_REPO_URL,
      unlock,
      lock,
      addNewProfile,
      saveProfile,
      saveSystemSettings,
      openInstallSettings,
      closeInstallSettings,
      saveInstallSettings,
      openAdvancedRules,
      closeAdvancedRules,
      addExtraRuleGroup,
      removeExtraRuleGroup,
      saveAdvancedRules,
      toggleEnabled,
      deleteProf,
      exportDb,
      openImportPicker,
      importDb,
      copyProfileLink,
      copyAllLinks,
      copyInstallCommand,
      formattedTime
    };
  }
});

app.mount('#app');
