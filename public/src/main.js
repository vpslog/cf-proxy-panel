const { createApp, ref, computed, onMounted } = Vue;

const PROJECT_REPO_URL = 'https://github.com/vpslog/cf-proxy-panel';
const INSTALLER_URL = 'https://raw.githubusercontent.com/vpslog/cf-proxy-panel/main/install.sh';

const app = createApp({
  template: '#app-template',
  setup() {
    const tokenInput = ref(getAuthToken());
    const authed = ref(Boolean(getAuthToken()));
    const profiles = ref([]);
    const draftAlias = ref('');
    const draftUrl = ref('');
    const exportTarget = ref('clash');
    const ruleMode = ref('balanced');
    const loading = ref(false);
    const savingId = ref('');
    const notice = ref('');
    const error = ref('');

    const ruleOptions = [
      { value: 'balanced', label: '通用分流' },
      { value: 'blacklist', label: '黑名单' },
      { value: 'global', label: '全代理' },
      { value: 'direct', label: '全直连' }
    ];

    const enabledCount = computed(() => profiles.value.filter((profile) => profile.enabled).length);
    const canAdd = computed(() => draftAlias.value.trim() && draftUrl.value.trim());
    const installCommand = computed(() => {
      const webUrl = shellQuote(window.location.origin);
      const token = shellQuote(getAuthToken());

      return `curl -fsSL ${INSTALLER_URL} -o /tmp/cf-proxy-panel-install.sh && sudo env SUBCONVERT_NON_INTERACTIVE=1 SUBCONVERT_WEB_URL=${webUrl} SUBCONVERT_TOKEN=${token} SUBCONVERT_ALIAS="$(hostname)" bash /tmp/cf-proxy-panel-install.sh`;
    });

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
      if (exportTarget.value === 'clash') {
        params.set('rule', ruleMode.value);
      }
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
        profiles.value = await loadProfiles();
      } catch (e) {
        if (e.message === 'UNAUTHORIZED') {
          authed.value = false;
          flash('访问令牌无效，请重新验证。', true);
        } else {
          flash('订阅列表加载失败，请稍后重试。', true);
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

    function copyProfileLink(profile) {
      return copyText(exportUrl(profile), '单个订阅链接已复制。');
    }

    function copyAllLinks() {
      return copyText(exportUrl(), '合并订阅链接已复制。');
    }

    function copyInstallCommand() {
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
      ruleMode,
      ruleOptions,
      loading,
      savingId,
      notice,
      error,
      enabledCount,
      canAdd,
      installCommand,
      projectRepoUrl: PROJECT_REPO_URL,
      unlock,
      lock,
      addNewProfile,
      saveProfile,
      toggleEnabled,
      deleteProf,
      copyProfileLink,
      copyAllLinks,
      copyInstallCommand,
      formattedTime
    };
  }
});

app.mount('#app');
