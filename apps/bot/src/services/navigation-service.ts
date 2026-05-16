import { ScreenId, UserRole, canAccessScreen, getRootScreen } from "./screen-service";

interface NavigationState {
  current: ScreenId;
  history: ScreenId[];
}

export class NavigationService {
  private readonly states = new Map<number, NavigationState>();

  reset(userId: number, role: UserRole): ScreenId {
    const rootScreen = getRootScreen(role);

    this.states.set(userId, {
      current: rootScreen,
      history: [],
    });

    return rootScreen;
  }

  getCurrent(userId: number, role: UserRole): ScreenId {
    const existingState = this.states.get(userId);

    if (!existingState) {
      return this.reset(userId, role);
    }

    return existingState.current;
  }

  moveTo(userId: number, role: UserRole, targetScreen: ScreenId): ScreenId {
    if (!canAccessScreen(role, targetScreen)) {
      throw new Error(`Screen ${targetScreen} is not available for role ${role}`);
    }

    const currentScreen = this.getCurrent(userId, role);

    if (currentScreen === targetScreen) {
      return currentScreen;
    }

    const currentState = this.states.get(userId) ?? {
      current: getRootScreen(role),
      history: [],
    };

    this.states.set(userId, {
      current: targetScreen,
      history: [...currentState.history, currentScreen],
    });

    return targetScreen;
  }

  goBack(userId: number, role: UserRole): ScreenId {
    const currentState = this.states.get(userId);

    if (!currentState || currentState.history.length === 0) {
      return this.reset(userId, role);
    }

    const history = [...currentState.history];
    const previousScreen = history.pop() ?? getRootScreen(role);

    this.states.set(userId, {
      current: previousScreen,
      history,
    });

    return previousScreen;
  }
}
