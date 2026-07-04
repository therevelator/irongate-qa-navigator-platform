import React, { useState } from 'react';
import { ArrowLeft, Trophy, Star, Target, Award, TrendingUp, Zap, Crown, Medal } from 'lucide-react';
import { generateGamificationData } from '../data/advancedFeatures';
import type { GamificationData } from '../data/advancedFeatures';

interface TeamGamificationProps {
  onBack: () => void;
}

const TeamGamification: React.FC<TeamGamificationProps> = ({ onBack }) => {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const gamificationData = generateGamificationData();

  if (!gamificationData.enabled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Trophy className="mx-auto text-gray-400 mb-4" size={64} />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Gamification Disabled</h2>
          <p className="text-gray-600 mb-6">Contact your administrator to enable team gamification features.</p>
          <button
            onClick={onBack}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Back to Features
          </button>
        </div>
      </div>
    );
  }

  const leaderboard = gamificationData.leaderboard.sort((a, b) => b.points - a.points);
  const topTeam = leaderboard[0];
  const avgPoints = leaderboard.length ? Math.round(leaderboard.reduce((acc, t) => acc + t.points, 0) / leaderboard.length).toLocaleString() : '--';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white">
        <div className="px-8 py-6">
          <button 
            onClick={onBack}
            className="flex items-center space-x-2 text-white/80 hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Back to Features</span>
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold flex items-center">
                <Trophy className="mr-3" size={32} />
                Team Gamification
              </h1>
              <p className="text-white/80 mt-1">Compete, achieve, and celebrate quality excellence!</p>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="text-center bg-white/10 rounded-lg px-6 py-3">
                <p className="text-sm text-white/80">Top Team</p>
                <div className="text-2xl font-bold">{topTeam.team_name}</div>
              </div>
              <div className="text-center bg-white/10 rounded-lg px-6 py-3">
                <p className="text-sm text-white/80">Top Score</p>
                <div className="text-2xl font-bold">{topTeam.points.toLocaleString()}</div>
              </div>
              <div className="text-center bg-white/10 rounded-lg px-6 py-3">
                <p className="text-sm text-white/80">Avg Points</p>
                <div className="text-2xl font-bold">{avgPoints}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-8 py-8">
        {/* Podium */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">🏆 Top 3 Teams 🏆</h2>
          <div className="flex items-end justify-center space-x-8">
            {/* 2nd Place */}
            {leaderboard[1] && (
              <div className="flex flex-col items-center">
                <div className="bg-gradient-to-br from-gray-300 to-gray-400 rounded-full w-24 h-24 flex items-center justify-center mb-3 shadow-lg">
                  <Medal className="text-white" size={48} />
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-lg p-6 w-64 text-center border-4 border-gray-300 dark:border-slate-700">
                  <div className="text-4xl font-bold text-gray-600 mb-2">2nd</div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{leaderboard[1].team_name}</h3>
                  <div className="text-2xl font-bold text-gray-700 mb-2">{leaderboard[1].points.toLocaleString()}</div>
                  <div className="flex justify-center space-x-1 text-2xl">
                    {leaderboard[1].badges.map((badge, i) => (
                      <span key={i}>{badge}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 1st Place */}
            {leaderboard[0] && (
              <div className="flex flex-col items-center -mt-8">
                <div className="bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full w-32 h-32 flex items-center justify-center mb-3 shadow-2xl animate-pulse">
                  <Crown className="text-white" size={64} />
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-8 w-72 text-center border-4 border-yellow-400">
                  <div className="text-5xl font-bold text-yellow-600 mb-2">1st</div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{leaderboard[0].team_name}</h3>
                  <div className="text-3xl font-bold text-yellow-600 mb-3">{leaderboard[0].points.toLocaleString()}</div>
                  <div className="flex justify-center space-x-1 text-3xl">
                    {leaderboard[0].badges.map((badge, i) => (
                      <span key={i}>{badge}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 3rd Place */}
            {leaderboard[2] && (
              <div className="flex flex-col items-center">
                <div className="bg-gradient-to-br from-orange-400 to-orange-600 rounded-full w-24 h-24 flex items-center justify-center mb-3 shadow-lg">
                  <Award className="text-white" size={48} />
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-lg p-6 w-64 text-center border-4 border-orange-400">
                  <div className="text-4xl font-bold text-orange-600 dark:text-orange-400 mb-2">3rd</div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{leaderboard[2].team_name}</h3>
                  <div className="text-2xl font-bold text-orange-700 mb-2">{leaderboard[2].points.toLocaleString()}</div>
                  <div className="flex justify-center space-x-1 text-2xl">
                    {leaderboard[2].badges.map((badge, i) => (
                      <span key={i}>{badge}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Full Leaderboard */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Full Leaderboard</h2>
          <div className="space-y-3">
            {leaderboard.map((team, index) => (
              <LeaderboardRow
                key={team.team_id}
                team={team}
                rank={index + 1}
                isSelected={selectedTeam === team.team_id}
                onSelect={() => setSelectedTeam(selectedTeam === team.team_id ? null : team.team_id)}
              />
            ))}
          </div>
        </div>

        {/* Achievement Categories */}
        <div className="grid grid-cols-3 gap-6">
          <AchievementCategory
            icon={<Trophy className="text-yellow-500" size={32} />}
            title="Quality Champions"
            description="Teams maintaining 95%+ test coverage"
            count={3}
          />
          <AchievementCategory
            icon={<Zap className="text-blue-500" size={32} />}
            title="Speed Demons"
            description="Fastest CI/CD pipeline execution"
            count={2}
          />
          <AchievementCategory
            icon={<Target className="text-green-500" size={32} />}
            title="Bug Hunters"
            description="Most bugs caught in testing"
            count={4}
          />
        </div>
      </div>
    </div>
  );
};

interface LeaderboardRowProps {
  team: GamificationData['leaderboard'][0];
  rank: number;
  isSelected: boolean;
  onSelect: () => void;
}

const LeaderboardRow: React.FC<LeaderboardRowProps> = ({ team, rank, isSelected, onSelect }) => {
  const getRankColor = (rank: number) => {
    if (rank === 1) return 'bg-yellow-100 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-900 dark:text-yellow-200';
    if (rank === 2) return 'bg-gray-100 dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-900 dark:text-white';
    if (rank === 3) return 'bg-orange-100 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700 text-orange-900 dark:text-orange-200';
    return 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 text-gray-900 dark:text-white';
  };

  const getRankIcon = (rank: number) => {
    if (rank === 1) return '👑';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  return (
    <div className={`rounded-lg border-2 p-4 transition-all ${getRankColor(rank)} ${isSelected ? 'ring-2 ring-blue-500' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4 flex-1">
          <div className="text-3xl font-bold w-16 text-center">
            {getRankIcon(rank)}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold">{team.team_name}</h3>
            <div className="flex items-center space-x-4 text-sm mt-1">
              <span className="flex items-center">
                <Star className="text-yellow-500 mr-1" size={14} />
                {team.points.toLocaleString()} points
              </span>
              <span className="flex items-center space-x-1">
                {team.badges.map((badge, i) => (
                  <span key={i} className="text-lg">{badge}</span>
                ))}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onSelect}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          {isSelected ? 'Hide Details' : 'View Achievements'}
        </button>
      </div>

      {isSelected && (
        <div className="mt-4 pt-4 border-t border-gray-300 dark:border-slate-700">
          <h4 className="font-semibold mb-3">🏆 Achievements</h4>
          <div className="space-y-2">
            {team.achievements.map(achievement => (
              <div key={achievement.id} className="bg-white/50 dark:bg-slate-800/50 rounded-lg p-3 flex items-start space-x-3">
                <div className="text-3xl">{achievement.icon}</div>
                <div className="flex-1">
                  <h5 className="font-semibold text-gray-900 dark:text-white">{achievement.name}</h5>
                  <p className="text-sm text-gray-600 dark:text-slate-400">{achievement.description}</p>
                  <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">
                    Earned: {new Date(achievement.earned_date).toLocaleDateString()}
                  </p>
                </div>
                <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-semibold">
                  {achievement.category}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 bg-blue-50 rounded-lg p-4">
            <h5 className="font-semibold text-blue-900 mb-2">💡 How to Earn More Points</h5>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Maintain 95%+ test coverage: <strong>+500 points</strong></li>
              <li>• Zero production bugs for a sprint: <strong>+1000 points</strong></li>
              <li>• Fastest CI/CD pipeline: <strong>+300 points</strong></li>
              <li>• Improve code quality score by 10%: <strong>+400 points</strong></li>
              <li>• Complete all tests on time: <strong>+200 points</strong></li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

interface AchievementCategoryProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  count: number;
}

const AchievementCategory: React.FC<AchievementCategoryProps> = ({ icon, title, description, count }) => {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-6">
      <div className="flex items-start space-x-4">
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{title}</h3>
          <p className="text-sm text-gray-600 mb-3">{description}</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-slate-400 dark:text-slate-400">{count} teams qualified</span>
            <TrendingUp className="text-green-500" size={20} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamGamification;
